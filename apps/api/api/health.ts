export default function handler(_req: unknown, res: { statusCode: number; end: (s: string) => void }): void {
	res.statusCode = 200
	res.end('ok')
}
