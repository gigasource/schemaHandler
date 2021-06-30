const pluginsList = {
	'sync-flow': require('../sync-flow'),
	'sync-plugin-multi': require('../sync-plugin-multi'),
	'sync-queue-commit': require('../sync-queue-commit'),
	'sync-snapshot': require('../sync-snapshot'),
	'sync-transporter': require('../sync-transporter')
}
const hooks = require('../../hooks/hooks')
const Orm = require('../../orm')
const uuid = require('uuid')
const { Socket, Io } = require('../../io/io')

/**
 *
 * @param plugins
 * @param options
 *  - isMaster: orm is master or not
 * @returns {{
 *  orm,
 *  waitAllEmit: (function(): Promise<T[]>) Function will wait for all emit
 *  setOrmAsMaster: (function())
 * }}
 */
module.exports = async function (plugins, options) {
	const ormHook = new hooks()
	const orm = new Orm()
	if (plugins && plugins.length) {
		plugins.forEach(plugin => {
			orm.plugin(pluginsList[plugin])
		})
	} else if (typeof plugins === 'object') {
		options = plugins
	}

	//<editor-fold desc="Mock hooks">
	const oldEmit = orm.emit
	const oldOn = orm.on
	const emitPromises = []
	const listEvents = {}
	const isLock = {} // lock hooks
	orm.emit = jest.fn(function ()  {
		const event = arguments[0]
		if (isLock[event])
			return
		const handlers = orm.emitPrepare('all', ...arguments);
		let isPromise = false
		if (Array.isArray(handlers)) {
			for (let handler of handlers) {
				if (handler instanceof Promise || handler.toString().trim().startsWith('async') || handler.isPromise)
					isPromise = true
			}
		} else if (handlers) {
			if (handlers instanceof Promise || handlers.toString().trim().startsWith('async') || handlers.isPromise)
				isPromise = true
		}
		if (isPromise) {
			const promise = new Promise(async (resolve) => {
				const result = await oldEmit.call(orm, ...arguments)
				resolve(result)
			})
			emitPromises.push(promise)
			return promise
		}
		return oldEmit.call(orm, ...arguments)
	})
	orm.on = jest.fn(function () {
		const fn = arguments[1]
		const mockFn = jest.fn(function () {
			return fn.call(this, ...arguments)
		})
		if (fn.toString().trim().startsWith('async')) {
			mockFn.isPromise = true
		}
		return oldOn.call(this, arguments[0], mockFn)
	})
	//</editor-fold>

	//<editor-fold desc="Handle options">
	if (!options)
		options = {}
	if (options.name) {
		orm.name = options.name
	} else {
		orm.name = 'test'
	}

	setOrmAsMaster(options.setMaster)
	//</editor-fold>

	orm.connect({uri: "mongodb://localhost:27017"}, orm.name, (err, db) => {
		if (err)
			return err
		orm.client.db(orm.name).dropDatabase()
	})

	//<editor-fold desc="Additional function">
	/**
	 * Wait for all emit events complete
	 * @param timeout
	 * @returns {Promise<unknown>}
	 */
	async function waitAllEmit(timeout) {
		if (!timeout) {
			const data = await Promise.all(emitPromises)
			return data
		} else {
			const data = await new Promise(async resolve => {
				setTimeout(() => {
					resolve(null)
				}, timeout)
				resolve(await Promise.all(emitPromises))
			})
			return data
		}
	}
	function setLockEvent(event, isLock) {
		isLock[event] = isLock
	}

	/**
	 * This function mock io function to orm
	 * @param isMaster
	 */
	function setOrmAsMaster(isMaster) {
		orm.emit('commit:flow:setMaster', isMaster)
		if (isMaster) {
			const isConnected = {}
			orm.ioId = uuid.v1()
			orm.io = new Io()
			orm.io.listen(orm.ioId)
			orm.io.on('connect', (socket) => {
				orm.emit('initSyncForMaster', socket)
				ormHook.emit('io:newClient', socket.name)
				isConnected[socket.name] = socket
			})
			orm.setEventForClientSocket = function (clientName, ...args) {
				isConnected[clientName].on(...args)
			}
			orm.emitForClientSocket = function (clientName, ...args) {
				isConnected[clientName].emit(...args)
			}
			orm.waitForClient = async function (clientName) {
				if (isConnected[clientName])
					return
				await new Promise(resolve => {
					ormHook.on('io:newClient', socketName => {
						if (socketName === clientName)
							resolve()
					})
				})
			}
		} else {
			const socket = new Socket()
			orm.socket = socket
			orm.socketConnect = function (id) {
				orm.socket.connect(id, orm.name)
				orm.emit('initSyncForClient', orm.socket)
			}
		}
	}

	async function mockCommits(numberOfCommits) {
		for (let i = 1; i <= numberOfCommits; i++) {
			await orm('Commit').create({
				id: i
			})
		}
		await orm('CommitData').updateOne({}, {
			highestCommitId: numberOfCommits
		}, { upsert: true })
	}

	let highestId = 0
	orm.on('update:Commit:c', commit => {
		highestId = Math.max(highestId, commit.id)
		ormHook.emit('newCommit', commit)
	})
	async function waitToSync(highestCommitId) {
		await new Promise(async (resolve) => {
			if (highestId === highestCommitId)
				resolve()
			ormHook.on('newCommit', () => {
				if (highestId === highestCommitId)
					resolve()
			})
		})
	}
	//</editor-fold>

	return {
		orm,
		waitAllEmit,
		setLockEvent,
		mockCommits,
		waitToSync,
		setOrmAsMaster
	}
}