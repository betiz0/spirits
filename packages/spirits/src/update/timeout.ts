/**
 * Idle-timeout fetch wrapper for update requests.
 *
 * The timer measures time without received data: it is armed when the request is sent, re-armed
 * when the response headers arrive, and re-armed for every body chunk. A slow but continuous
 * download therefore never times out, while a stalled connection does.
 */

import { DEFAULT_UPDATE_IDLE_TIMEOUT_SECONDS, ENV_UPDATE_IDLE_TIMEOUT_SECONDS } from "../constants.ts";
import type { EnvLike, FetchLike } from "./types.ts";

/** Positive decimal integers only; the same validation rule the other spirits limit readers use. */
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

const MILLISECONDS_PER_SECOND = 1000;

/** Thrown when an update request receives no data for the configured idle window. */
export class UpdateIdleTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`No data received for ${timeoutMs} ms; the update request timed out.`);
		this.name = "UpdateIdleTimeoutError";
	}
}

/** Resolve the idle timeout in seconds; absent or invalid values fall back to the default. */
export function resolveIdleTimeoutSeconds(env: EnvLike): number {
	const raw = env[ENV_UPDATE_IDLE_TIMEOUT_SECONDS];
	if (raw === undefined || !POSITIVE_INTEGER_PATTERN.test(raw)) {
		return DEFAULT_UPDATE_IDLE_TIMEOUT_SECONDS;
	}
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) {
		return DEFAULT_UPDATE_IDLE_TIMEOUT_SECONDS;
	}
	return value;
}

/** Resolve the idle timeout in milliseconds. */
export function resolveIdleTimeoutMs(env: EnvLike): number {
	return resolveIdleTimeoutSeconds(env) * MILLISECONDS_PER_SECOND;
}

/**
 * Fetch a URL and fail when no data is received for `timeoutMs`.
 *
 * The returned response body is wrapped so each received chunk re-arms the timer. When the
 * timeout fires the underlying request is aborted and the body read fails with
 * `UpdateIdleTimeoutError`.
 */
export async function fetchWithIdleTimeout(
	fetchImpl: FetchLike,
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const clearTimer = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	};
	const armTimer = (): void => {
		clearTimer();
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
	};

	armTimer();
	let response: Response;
	try {
		response = await fetchImpl(url, { ...init, signal: controller.signal });
	} catch (error) {
		clearTimer();
		if (timedOut) throw new UpdateIdleTimeoutError(timeoutMs);
		throw error;
	}
	if (!response.body) {
		clearTimer();
		return response;
	}

	armTimer();
	const reader = response.body.getReader();
	const stream = new ReadableStream<Uint8Array>({
		async pull(streamController) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					clearTimer();
					streamController.close();
					return;
				}
				armTimer();
				streamController.enqueue(value);
			} catch (error) {
				clearTimer();
				if (timedOut) {
					streamController.error(new UpdateIdleTimeoutError(timeoutMs));
				} else {
					streamController.error(error);
				}
			}
		},
		async cancel(reason) {
			clearTimer();
			await reader.cancel(reason);
		},
	});
	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}
