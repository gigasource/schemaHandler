const pluginsList = {
	'sync-flow': require('../sync-flow'),
	'sync-plugin-multi': require('../sync-plugin-multi'),
	'sync-queue-commit': require('../sync-queue-commit'),
	'sync-snapshot': require('../sync-snapshot'),
	'sync-transporter': require('../sync-transporter'),
	'sync-report': require('../sync-report')
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
async function ormGenerator(plugins, options) {
	const ormHook = new hooks()
	const orm = new Orm()

	//<editor-fold desc="Mock hooks">
	const oldEmit = orm.emit
	const oldOn = orm.on
	let emitPromises = []
	let emitPromisesId = {}
	let hasBeenCalled = {}
	const listEvents = {}
	const isLock = {} // lock hooks
	orm.emit = jest.fn(function ()  {
		const event = arguments[0]
		if (isLock[event])
			return
		const result = oldEmit.call(orm, ...arguments)
		if (result instanceof Promise) {
			emitPromises.push(result)
			if (!emitPromisesId[event])
				emitPromisesId[event] = []
			emitPromisesId[event].push(emitPromises.length - 1)
		}
		if (!hasBeenCalled[event])
			hasBeenCalled[event] = 0
		hasBeenCalled[event] += 1
		ormHook.emit(`event:${event}`)
		return result
	})
	const onCalled = {}
	orm.on = jest.fn(function () {
		const event = arguments[0]
		let fn = arguments[1]
		let layer = 0
		if (typeof fn !== 'function') {
			layer = arguments[1]
			fn = arguments[2]
		}
		const mockFn = jest.fn(function () {
			if (!onCalled[event])
				onCalled[event] = 0
			onCalled[event] += 1
			return fn.call(this, ...arguments)
		})
		if (fn.toString().trim().startsWith('async')) {
			mockFn.isPromise = true
		}
		if (arguments.length === 3)
			return oldOn.call(this, event, layer, mockFn)
		return oldOn.call(this, event, mockFn)
	})
	//</editor-fold>

	if (plugins && plugins.length) {
		plugins.forEach(plugin => {
			if (typeof plugin === 'string')
				orm.plugin(pluginsList[plugin])
			else
				orm.plugin(plugin)
		})
	} else if (typeof plugins === 'object') {
		options = plugins
	}

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
			emitPromises = []
			emitPromisesId = {}
			return data
		} else {
			const data = await new Promise(async resolve => {
				setTimeout(() => {
					resolve(null)
				}, timeout)
				const result = await Promise.all(emitPromises)
				emitPromisesId = {}
				emitPromises = []
				resolve(result)
			})
			return data
		}
	}

	// get all promises of an event
	function getPromisesOfEvent(event) {
		if (!emitPromisesId[event])
			return []
		const result = []
		emitPromisesId[event].forEach(id => {
			result.push(emitPromises[id])
		})
		return result
	}

	async function waitForAnEvent(event) {
		const listPromises = getPromisesOfEvent(event)
		await Promise.all(listPromises)
	}

	function setLockEvent(event, _isLock) {
		isLock[event] = _isLock
	}

	async function waitEventIsCalled(event, numberOfTimes = 1) {
		await new Promise(resolve => {
			if (hasBeenCalled[event] >= numberOfTimes)
				resolve()
			const { off } = ormHook.on(`event:${event}`, () => {
				if (hasBeenCalled[event] >= numberOfTimes) {
					off()
					resolve()
				}
			})
		})
	}

	function getNumberOfTimesCalled(event) {
		return hasBeenCalled[event]
	}

	function getNumberOfTimesOnCalled(event) {
		return onCalled[event]
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

	async function mockModelAndCreateCommits(numberOfCommits, modelName = 'Model') {
		orm.registerCommitBaseCollection(modelName)
		for (let i = 1; i <= numberOfCommits; i++) {
			await orm(modelName).create({
				data: 'test'
			})
		}
		await waitForAnEvent('createCommit')
		await waitForAnEvent('commit:handler:finish')
	}

	let highestId = 0
	orm.on('update:Commit:c', 1, commit => {
		if (!commit.id || isNaN(commit.id)) return
		highestId = Math.max(highestId, commit.id)
		ormHook.emit('newCommit')
	})
	orm.on('update:CommitData', result => {
		if (!result.highestCommitId || isNaN(result.highestCommitId)) return
		highestId = Math.max(highestId, result.highestCommitId)
		ormHook.emit('newCommit')
	})
	async function waitToSync(highestCommitId) {
		await new Promise(async (resolve) => {
			if (highestId >= highestCommitId)
				resolve()
			const { off } = ormHook.on('newCommit', () => {
				if (highestId === highestCommitId) {
					resolve()
					off()
				}
			})
		})
	}
	//</editor-fold>

	await orm('Commit').createIndex( { id: 1 })

	return {
		orm,
		utils: {
			waitAllEmit,
			setLockEvent,
			mockCommits,
			waitToSync,
			setOrmAsMaster,
			getPromisesOfEvent,
			waitEventIsCalled,
			waitForAnEvent,
			getNumberOfTimesCalled,
			getNumberOfTimesOnCalled,
			mockModelAndCreateCommits
		}
	}
}

module.exports = ormGenerator
module.exports.genOrm = async function (numberOfOrm, plugins) {
	const result = {
		orms: [],
		utils: []
	}
	for (let i = 0; i < numberOfOrm; i++) {
		const { orm, utils } = await ormGenerator(plugins, {
			name: i + '',
			setMaster: (i === 0)
		})
		result.orms.push(orm)
		result.utils.push(utils)
	}
	return result
}
