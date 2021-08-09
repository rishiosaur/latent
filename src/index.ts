#!/usr/bin/env node

import { Command } from 'commander'
import { NodeSSH } from 'node-ssh'
import expandTilde from 'expand-tilde'
import { nanoid } from 'nanoid'
import { compile } from 'handlebars'
import { readdir, writeFile, readFile } from 'fs/promises'

import path from 'path'
import { readFileSync } from 'fs'
import { execSync, exec } from 'child_process'
import { stdout } from 'process'
import { getPort } from './ports'
import { getConfig } from './config'
require('better-logging')(console)

export const ssh = new NodeSSH()
const program = new Command()
program.version('0.0.1')

program
	.command('init <domain>')
	.description('Initiate a new repository on the client directory.')
	.action(async (e) => {
		console.log(e)
		const id = nanoid()
		const defaultBranch = execSync('git branch --show-current').toString()

		const files = await readdir(process.cwd())

		if ('latent.json' in files) {
			console.error(`Looks like this directory has already been set up!`)
			return
		}

		if (!files.includes('entry.sh')) {
			console.error(`To set up a Latent project, you need an entry.sh file.`)
			return
		}

		const config = await getConfig()

		await ssh.connect({
			host: config.host,
			username: config.username,
			password: config.password,
			passphrase: config.password,
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
					domain: e,
				},
				null,
				2
			)
		)

		console.log(`Creating \`/opt/latent/${id}\` directory on server.`)
		await ssh.exec(`mkdir /opt/latent/${id}`, [])
		// await ssh
		// 	.putDirectory(process.cwd(), `/opt/latent/${id}`, { recursive: true })
		// 	.then(() => console.log('Successfully copied directory over.'))

		console.log(`Initializing git repository \`/opt/latent/${id}\` on server.`)
		await ssh.exec(`git init --shared /opt/latent/${id}`, [])
		await ssh.exec(
			`cd /opt/latent/${id} && git config receive.denyCurrentBranch updateInstead`,
			[]
		)
		console.log(execSync('git branch -m master').toString())

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
				domain: e,
			})}' > /etc/systemd/system/${id}.latent.service`,
			[]
		)
		await ssh.exec(`systemctl daemon-reload`, [])

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
				domain: e,
			})}' > /etc/nginx/sites-enabled/${id}-latent.conf`,
			[]
		)

		await ssh.exec(`sudo nginx -s reload`, [])

		console.log(`Generating domain & certificate for ${e}`)
		await ssh.execCommand(`certbot -i nginx -d ${e} --nginx --redirect`, {
			onStdout: (e) => {
				console.log(e.toString())
			},
		})

		console.log('generating git hooks')
		const gitcompile = compile(
			readFileSync(path.join(__dirname, 'git.js.hbs')).toString()
		)

		await ssh.execCommand(
			`echo '${gitcompile({
				id,
			})}' > /opt/latent/${id}/.git/hooks/post-receive`,
			{
				onStdout: (e) => {
					console.log(e.toString())
				},
			}
		)

		await ssh.execCommand(
			`chmod +x /opt/latent/${id}/.git/hooks/post-receive`,
			{
				onStdout: (e) => {
					console.log(e.toString())
				},
			}
		)

		await exec(
			`git init --shared && git remote add deploy ${config.username}@${config.host}:/opt/latent/${id}`
		)

		await ssh.dispose()
	})

program
	.command('logs')
	.description('Get a live feed of production logs.')
	.action(async () => {
		const local = (p) => path.join(process.cwd(), p)
		const files = await readdir(process.cwd())

		if (!files.includes('latent.json')) {
			console.error(`${process.cwd()} is not a Latent directory.`)
			return
		}
		const config = await getConfig()
		await ssh.connect({
			host: config.host,
			username: config.username,
			password: config.password,
			passphrase: config.password,
			port: 22,
		})

		const { id } = JSON.parse((await readFile(local('latent.json'))).toString())
		console.log(`journalctl -xe -f -u ${id}.latent.service`)
		const s = (
			await ssh.execCommand(`journalctl -xe -f -u ${id}.latent.service`, {
				onStdout: (e) => console.log(e.toString()),
			})
		).toString()
		console.log(s)
		await ssh.dispose()
	})
program
	.command('status')
	.description('Get the status of a Latent project from your server.')
	.action(async () => {
		const local = (p) => path.join(process.cwd(), p)
		const files = await readdir(process.cwd())

		if (!files.includes('latent.json')) {
			console.error(`${process.cwd()} is not a Latent directory.`)
			return
		}
		const config = await getConfig()
		await ssh.connect({
			host: config.host,
			username: config.username,
			password: config.password,
			passphrase: config.password,
			port: 22,
		})

		const { id } = JSON.parse((await readFile(local('latent.json'))).toString())

		const s = (
			await ssh.exec(`systemctl status ${id}.latent.service`, [], {
				stream: 'stdout',
			})
		).toString()
		console.log(s)
		await ssh.dispose()
	})

program
	.command('start')
	.description('Start up your project.')
	.action(async () => {
		const local = (p) => path.join(process.cwd(), p)
		const files = await readdir(process.cwd())

		if (!files.includes('latent.json')) {
			console.error(`${process.cwd()} is not a Latent directory.`)
			return
		}
		const config = await getConfig()
		await ssh.connect({
			host: config.host,
			username: config.username,
			password: config.password,
			passphrase: config.password,
			port: 22,
		})

		const { id } = JSON.parse((await readFile(local('latent.json'))).toString())

		await ssh.execCommand(`systemctl start ${id}.latent.service`, {
			onStdout: (e) => console.log(e.toString()),
		})

		await ssh.dispose()
	})

program
	.command('stop')
	.description('Stop your project.')
	.action(async () => {
		const local = (p) => path.join(process.cwd(), p)
		const files = await readdir(process.cwd())

		if (!files.includes('latent.json')) {
			console.error(`${process.cwd()} is not a Latent directory.`)
			return
		}
		const config = await getConfig()
		await ssh.connect({
			host: config.host,
			username: config.username,
			password: config.password,
			passphrase: config.password,
			port: 22,
		})

		const { id } = JSON.parse((await readFile(local('latent.json'))).toString())

		await ssh.execCommand(`systemctl stop ${id}.latent.service`, {
			onStdout: (e) => console.log(e.toString()),
		})

		await ssh.dispose()
	})

program
	.command('restart')
	.description('Restart your project.')
	.action(async () => {
		const local = (p) => path.join(process.cwd(), p)
		const files = await readdir(process.cwd())

		if (!files.includes('latent.json')) {
			console.error(`${process.cwd()} is not a Latent directory.`)
			return
		}
		const config = await getConfig()
		await ssh.connect({
			host: config.host,
			username: config.username,
			password: config.password,
			passphrase: config.password,
			port: 22,
		})

		const { id } = JSON.parse((await readFile(local('latent.json'))).toString())

		await ssh.execCommand(`systemctl restart ${id}.latent.service`, {
			onStdout: (e) => console.log(e.toString()),
		})

		await ssh.dispose()
	})

program
	.command('domain')
	.description('Get domain for a Latent project')
	.action(async () => {
		const local = (p) => path.join(process.cwd(), p)
		const files = await readdir(process.cwd())

		if (!files.includes('latent.json')) {
			console.error(`${process.cwd()} is not a Latent directory.`)
			return
		}

		const latent = JSON.parse(readFileSync(local('latent.json')).toString())
		if (latent.domain) {
			console.log(latent.domain)
		} else {
			console.error(
				'Could not find domain for Latent project. Are you sure it was set up correctly?'
			)
		}
	})

program.parse(process.argv)
