// Produces the self-contained serverless bundle Vercel's function wrapper imports.
// Optional Nest peer deps are stubbed to throw on require, which Nest catches.
const OPTIONAL = /^(@nestjs\/(graphql|microservices|websockets)|@apollo\/|class-transformer\/storage)/

const result = await Bun.build({
	entrypoints: ["src/serverless-entry.ts"],
	target: "bun",
	format: "esm",
	plugins: [
		{
			name: "stub-optional-deps",
			setup(b) {
				b.onResolve({ filter: OPTIONAL }, (args) => ({
					path: args.path,
					namespace: "optional-stub",
				}))
				b.onLoad({ filter: /.*/, namespace: "optional-stub" }, () => ({
					contents: 'throw new Error("optional dependency not installed")',
					loader: "js",
				}))
			},
		},
	],
})
if (!result.success) {
	console.error(result.logs.join("\n"))
	process.exit(1)
}
await Bun.write("api/bundle.mjs", result.outputs[0])
console.log("api/bundle.mjs written")
