import { afterAll, expect, test } from "bun:test";
import { DEFAULT_UPDATE_IDLE_TIMEOUT_SECONDS } from "../src/constants.ts";
import {
	UpdateIdleTimeoutError,
	fetchWithIdleTimeout,
	resolveIdleTimeoutMs,
	resolveIdleTimeoutSeconds,
} from "../src/update/timeout.ts";

const runningServers: Array<ReturnType<typeof Bun.serve>> = [];

afterAll(() => {
	for (const server of runningServers) {
		server.stop(true);
	}
});

test("defaults to 10 seconds for unset or invalid values", () => {
	for (const value of [undefined, "0", "-1", "1.5", "abc"]) {
		const env = value === undefined ? {} : { SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS: value };
		expect(resolveIdleTimeoutSeconds(env)).toBe(DEFAULT_UPDATE_IDLE_TIMEOUT_SECONDS);
	}
});

test("uses a positive integer override in seconds", () => {
	expect(resolveIdleTimeoutSeconds({ SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS: "2" })).toBe(2);
	expect(resolveIdleTimeoutMs({ SPIRITS_UPDATE_IDLE_TIMEOUT_SECONDS: "2" })).toBe(2000);
});

test("fails with an idle-timeout error while waiting for response headers", async () => {
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Promise<Response>(() => {});
		},
	});
	runningServers.push(server);
	let caught: unknown;
	try {
		await fetchWithIdleTimeout(fetch, `http://127.0.0.1:${server.port}/binary`, {}, 50);
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(UpdateIdleTimeoutError);
	server.stop(true);
});

test("fails with an idle-timeout error when the response stops mid-download", async () => {
	const server = Bun.serve({
		port: 0,
		fetch() {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("start"));
				},
			});
			return new Response(stream);
		},
	});
	runningServers.push(server);
	const response = await fetchWithIdleTimeout(fetch, `http://127.0.0.1:${server.port}/binary`, {}, 50);
	let caught: unknown;
	try {
		await response.text();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(UpdateIdleTimeoutError);
	server.stop(true);
});

test("does not fail while data keeps arriving, even past the idle window in total", async () => {
	const chunks = 6;
	const intervalMs = 25;
	const server = Bun.serve({
		port: 0,
		fetch() {
			let sent = 0;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const timer = setInterval(() => {
						sent += 1;
						controller.enqueue(new TextEncoder().encode("x"));
						if (sent === chunks) {
							clearInterval(timer);
							controller.close();
						}
					}, intervalMs);
				},
			});
			return new Response(stream);
		},
	});
	runningServers.push(server);
	const response = await fetchWithIdleTimeout(fetch, `http://127.0.0.1:${server.port}/binary`, {}, 100);
	const body = await response.text();
	expect(body).toBe("x".repeat(chunks));
	expect(chunks * intervalMs).toBeGreaterThan(100);
	server.stop(true);
});
