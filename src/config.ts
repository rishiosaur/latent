import { readFile } from 'fs/promises'
import expandTilde from 'expand-tilde'

interface Config {
	host: string
	username: string
	password: string
}

export const getConfig = async () => {
	const buf = await readFile(expandTilde('~/.config/latent/config.json'))
	const str = buf.toString()

	return JSON.parse(str) as Config
}
