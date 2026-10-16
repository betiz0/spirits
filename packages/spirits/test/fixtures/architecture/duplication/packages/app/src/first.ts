interface Resource {
	[key: string]: string | boolean;
}

export function buildResource(kind: string): Resource {
	const name = `${kind}-resource`;
	const path = `/tmp/${kind}`;
	const content = `resource for ${kind}`;
	const meta = { name, path, content };
	const created = { ...meta };
	const prepared = { ...created, prepared: true };
	const validated = { ...prepared, validated: true };
	const registered = { ...validated, registered: true };
	const finalized = { ...registered, finalized: true };
	return finalized;
}
