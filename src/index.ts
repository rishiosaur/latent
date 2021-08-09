#!/usr/bin/env node

import { Command } from 'commander'
import { NodeSSH } from 'node-ssh'
import expandTilde from 'expand-tilde'
import { nanoid } from 'nanoid'
import { compile } from 'handlebars'
import { readdir, writeFile } from 'fs/promises'

import path from 'path'
import { readFileSync } from 'fs'
import { execSync, exec } from 'child_process'
import { getPort } from './ports'
import { getConfig } from './config'
require('better-logging')(console)

export const ssh = new NodeSSH()
const program = new Command()
program.version('0.0.1')

program
	.command('init <type>')
	.description('Initiate a new repository on the client directory.')
	.action(async () => {
		const id = nanoid()

		const files = await readdir(process.cwd())

		if ('latent.json' in files) {
			console.error(`Looks like this directory has already been set up!`)
			return
		}

		const config = await getConfig()

		await ssh.connect({
			host: config.host,
			username: config.username,
			password: 'sY2gF9gO7yA1iC3iG0pB6aL7oO0yA9dU',
			passphrase: 'sY2gF9gO7yA1iC3iG0pB6aL7oO0yA9dU',
			port: 22,
		})

		await exec(`git init --shared ${process.cwd()}`)
		console.info(`Starting deploy process for ${id}.`)
		console.log('Creating `latent.json` file in directory.')
		const local = (p) => path.join(process.cwd(), p)

		await writeFile(
			local('latent.json'),
			JSON.stringify(
				{
					id,
				},
				null,
				2
			)
		)

		console.log(`Creating \`/opt/latent/${id}\` directory on server.`)
		await ssh
			.putDirectory(process.cwd(), `/opt/latent/${id}`, { recursive: true })
			.then(() => console.log('Successfully copied directory over.'))

		console.log(`Initializing git repository \`/opt/latent/${id}\` on server.`)
		await ssh.exec(`git init`, [`/opt/latent/${id}`, '--shared'])

		console.log(`Allocating port to \`/opt/latent/${id}\` on server.`)
		const port = await getPort(id)
		console.log(`Port allocated to ${id}: ${port}`)

		console.log(
			`Creating systemd configuration for \`/opt/latent/${id}\` on server.`
		)
		const systemdcompile = compile(
			readFileSync(path.join(__dirname, 'systemd.service.hbs')).toString()
		)
		await ssh.exec(
			`echo '${systemdcompile({
				site: id,
				port,
			})}' > ~/.config/systemd/user/${id}.latent.service`,
			[]
		)
		await ssh.exec(`systemctl --user daemon-reload`, [])

		// await ssh.exec(`systemctl --user enable`, [`${id}.latent.service`])

		console.log(
			`Generating NGINX configuration for \`/opt/latent/${id}\` on server.`
		)
		const nginxcompile = compile(
			readFileSync(path.join(__dirname, 'nginx.conf.hbs')).toString()
		)
		await ssh.exec(
			`echo '${nginxcompile({
				site: id,
				port,
			})}' > /etc/nginx/sites-enabled/${id}-latent.conf`,
			[]
		)

		await ssh.exec(`sudo nginx -s reload`, [])
		await ssh.dispose()
	})

program.parse(process.argv)
