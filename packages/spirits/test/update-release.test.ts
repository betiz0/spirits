import { afterAll, expect, test } from "bun:test";
import {
	NoStableReleaseError,
	resolveApiBaseUrl,
	resolveLatestStableRelease,
	selectLatestStableTag,
	tagToVersion,
} from "../src/update/release.ts";
import type { FetchLike } from "../src/update/types.ts";

interface Fixture {
	server: ReturnType<typeof Bun.serve>;
	baseUrl: string;
	requests: string[];
	stop(): void;
}

const runningServers: Array<ReturnType<typeof Bun.serve>> = [];

afterAll(() => {
	for (const server of runningServers) {
		server.stop(true);
	}
});

function startReleasesServer(payload: unknown): Fixture {
	const requests: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			requests.push(new URL(request.url).pathname);
			return Response.json(payload);
		},
	});
	runningServers.push(server);
	return {
		server,
		baseUrl: `http://127.0.0.1:${server.port}`,
		requests,
		stop: () => server.stop(true),
	};
}

test("selects the newest non-draft non-prerelease spirits-v* release", async () => {
	const fixture = startReleasesServer([
		{ tag_name: "v9.9.9", draft: false, prerelease: false },
		{ tag_name: "spirits-v0.4.0", draft: true, prerelease: false },
		{ tag_name: "spirits-v0.3.0-rc.1", draft: false, prerelease: true },
		{ tag_name: "spirits-v0.3.0", draft: false, prerelease: false },
		{ tag_name: "spirits-v0.2.0", draft: false, prerelease: false },
	]);
	const release = await resolveLatestStableRelease({
		env: { SPIRITS_API_BASE_URL: fixture.baseUrl },
		fetch,
		timeoutMs: 2000,
	});
	expect(release).toEqual({ tag: "spirits-v0.3.0", version: "0.3.0" });
	fixture.stop();
});

test("honors SPIRITS_API_BASE_URL and requests 100 releases per page", async () => {
	const fixture = startReleasesServer([{ tag_name: "spirits-v0.1.0", draft: false, prerelease: false }]);
	const fetchImpl: FetchLike = (input, init) => {
		if (!input.startsWith(fixture.baseUrl)) {
			throw new Error(`unexpected request URL: ${input}`);
		}
		return fetch(input, init);
	};
	const release = await resolveLatestStableRelease({
		env: { SPIRITS_API_BASE_URL: fixture.baseUrl },
		fetch: fetchImpl,
		timeoutMs: 2000,
	});
	expect(release.version).toBe("0.1.0");
	expect(fixture.requests).toEqual(["/repos/betiz0/spirits/releases"]);
	fixture.stop();
});

test("fails when the release list has no stable spirits release", async () => {
	const fixture = startReleasesServer([
		{ tag_name: "v9.9.9", draft: false, prerelease: false },
		{ tag_name: "spirits-v0.4.0", draft: true, prerelease: false },
		{ tag_name: "spirits-v0.3.0-rc.1", draft: false, prerelease: true },
	]);
	await expect(
		resolveLatestStableRelease({
			env: { SPIRITS_API_BASE_URL: fixture.baseUrl },
			fetch,
			timeoutMs: 2000,
		}),
	).rejects.toBeInstanceOf(NoStableReleaseError);
	fixture.stop();
});

test("fails when the releases API returns an error status", async () => {
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response("nope", { status: 500 });
		},
	});
	runningServers.push(server);
	await expect(
		resolveLatestStableRelease({
			env: { SPIRITS_API_BASE_URL: `http://127.0.0.1:${server.port}` },
			fetch,
			timeoutMs: 2000,
		}),
	).rejects.toThrow("HTTP 500");
	server.stop(true);
});

test("resolves the API base URL with a fallback", () => {
	expect(resolveApiBaseUrl({})).toBe("https://api.github.com");
	expect(resolveApiBaseUrl({ SPIRITS_API_BASE_URL: "http://localhost:8080" })).toBe("http://localhost:8080");
});

test("selects and converts tags", () => {
	expect(selectLatestStableTag(["v1.0.0", "spirits-v0.2.0"])).toBe("spirits-v0.2.0");
	expect(selectLatestStableTag(["v1.0.0"])).toBeUndefined();
	expect(tagToVersion("spirits-v0.2.0")).toBe("0.2.0");
	expect(tagToVersion("spirits-v")).toBeUndefined();
	expect(tagToVersion("v0.2.0")).toBeUndefined();
});
