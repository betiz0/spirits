interface Helper {
	[key: string]: string | boolean;
}

export function makeHelper(kind: string): Helper {
	const name = `${kind}-helper`;
	const path = `/tmp/${kind}`;
	const content = `helper for ${kind}`;
	const meta = { name, path, content };
	const created = { ...meta };
	const prepared = { ...created, prepared: true };
	const validated = { ...prepared, validated: true };
	const registered = { ...validated, registered: true };
	const finalized = { ...registered, finalized: true };
	return finalized;
}
