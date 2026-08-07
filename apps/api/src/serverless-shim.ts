// NestJS resolves some packages with require(variable) at runtime, which no
// bundler can trace. This intercepts those lookups and returns the statically
// bundled copies instead, so the serverless bundle is truly self-contained.
import Module from "node:module"
import express from "express"
import * as platformExpress from "@nestjs/platform-express"

const table: Record<string, unknown> = {
	express,
	"@nestjs/platform-express": platformExpress,
}

const ModuleAny = Module as unknown as {
	_load: (id: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = ModuleAny._load
ModuleAny._load = function (id: string, parent: unknown, isMain: boolean) {
	if (id in table) return table[id]
	return origLoad.call(this, id, parent, isMain)
}
