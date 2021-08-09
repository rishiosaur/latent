import { ssh } from './index'

const portsdir = `/opt/latent/reserved/ports`

export const viewPort = async (id: string) => {
	const response = await ssh.exec(`grep -rnwl ${portsdir} -e`, [id])
	if (response.length === 0) {
		return null
	}
	return parseInt(response.replace(portsdir, '').replace('/', ''))
}

const portInDir = async (port) => {
	const exists = await ssh.exec(
		`[ -d '${portsdir}/${port}' ] && echo 'true'`,
		[]
	)
	return exists === 'true'
}

const portIsInUse = async (port) => {
	const result = await ssh.exec(
		`sudo lsof -nP -iTCP:${port} -sTCP:LISTEN >&2 >/dev/null ; echo $?`,
		[]
	)
	return result.trim() === '0'
}

export const getPort = async (id: string) => {
	const portExists = await viewPort(id)
	if (portExists) return portExists

	console.info(`Trying to get a port for project id ${id}`)
	const port = Math.floor(Math.random() * (65535 - 1024) + 1024)
	if ((await portInDir(port)) || (await portIsInUse(port))) {
		return getPort(id)
	}
	await ssh.exec(`echo '${id}' > ${portsdir}/${port}`, [])
	return port
}
