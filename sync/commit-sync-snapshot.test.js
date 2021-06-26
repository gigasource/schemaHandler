const Orm = require('../orm')
const { stringify } = require("../utils");
const Hooks = require('../hooks/hooks')
const ormA = new Orm()
ormA.name = 'A'
const ormB = new Orm()
ormB.name = 'B'
const ormC = new Orm()
ormC.name = 'C'

const { Socket, Io } = require('../io/io')
const masterIo = new Io()
masterIo.listen('local')
const s1 = new Socket()
const s2 = new Socket()

const delay = require("delay");
const controlHook = new Hooks()

describe('commit-sync-snapshot', function () {
	beforeAll(async (done) => {
		ormA.connect({ uri: "mongodb://localhost:27017" }, "myproject1")
		ormB.connect({ uri: "mongodb://localhost:27017" }, "myproject2")
		ormC.connect({ uri: "mongodb://localhost:27017" }, "myproject3")

		const orms = [ormA, ormB, ormC]

		for (const orm of orms) {
			orm.plugin(require('./sync-plugin-multi'))
			orm.plugin(require('./sync-queue-commit'))
			orm.plugin(require('./sync-transporter'))
			orm.plugin(require('./sync-snapshot'))
			orm.setSyncCollection('Model')
		}

		ormA.plugin(require('./sync-flow'), 'master')
		ormB.plugin(require('./sync-flow'), 'client')
		ormC.plugin(require('./sync-flow'), 'client')

		s1.connect('local')
		s2.connect('local')

		for (let orm of orms) {
			await orm('Model').remove({})
			await orm('Commit').remove({})
			await orm('Recovery').remove({})
			await orm('CommitData').remove({})
			await orm('QueueCommit').remove({})
		}

		for (const orm of orms) {
			orm.registerSchema('Model', {
				items: [{}]
			})
			orm.registerCommitBaseCollection('Model')
		}
		ormB.emit('initSyncForClient', s1)

		masterIo.on('connect', (socket) => {
			ormA.emit('initSyncForMaster', socket)
			controlHook.emit('newConnection')
			done()
		})
	})

	it('Case 1: Client with highest commit id sync with master', async (done) => {
		const a = await ormA('Model').create({ table: 10, items: [] })
		await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		let m1 = await ormA('Model').find({ table: 10 })
		let m2 = await ormB('Model').find({ table: 10 })
		await new Promise((resolve) => {
			const interval = setInterval(async () => {
				m1 = await ormA('Model').find({ table: 10 })
				m2 = await ormB('Model').find({ table: 10 })
				if (m1.toString() === m2.toString()) {
					clearInterval(interval)
					resolve()
				}
			}, 100)
		})
		ormA.startSyncSnapshot()

		ormA.on('snapshot-done', async () => {
			await delay(50)
			const commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			const commitsB = await ormB('Commit').find()
			expect(stringify(commitsB)).toMatchSnapshot()
			done()
		})
	}, 80000)

	it('Case 2: Client need to be resync', async (done) => {
		for (let i = 0; i < 300; i++) {
			await ormA('Model').create({ table: 10})
			await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		ormA.on('snapshot-done', async () => {
			ormC.emit('initSyncForClient', s2)
			ormA.emit('master:transport:sync')
			let a = await ormA('Model').find({ table: 10 })
			let c = await ormC('Model').find({ table: 10 })
			await new Promise(resolve => {
				const interval = setInterval(async () => {
					a = await ormA('Model').find({ table: 10 })
					c = await ormC('Model').find({ table: 10 })
					if (a.toString() === c.toString()) {
						clearInterval(interval)
						resolve()
					}
				}, 3000)
			})
			expect(a).toEqual(c)
			const commitDataC = await ormC('CommitData').findOne()
			// total 900 commits
			expect(commitDataC.highestCommitId).toBe(900)
			expect(commitDataC.syncData.needReSync).toBe(true)
			done()
		})
		ormA.startSyncSnapshot()
	}, 80000)

	it('Case 2a: Client do not need to resync', async (done) => {
		for (let i = 0; i < 100; i++) {
			await ormA('Model').create({ table: 10})
			await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		}
		const commit = await ormA('Commit').findOne({ id: 1 })
		ormC.emit('createCommit', commit)
		ormA.on('snapshot-done', async () => {
			ormC.emit('initSyncForClient', s2)
			ormA.emit('master:transport:sync')
			let a = await ormA('Model').find({ table: 10 })
			let c = await ormC('Model').find({ table: 10 })
			await new Promise(resolve => {
				const interval = setInterval(async () => {
					a = await ormA('Model').find({ table: 10 })
					c = await ormC('Model').find({ table: 10 })
					if (a.toString() === c.toString()) {
						clearInterval(interval)
						resolve()
					}
				}, 3000)
			})
			expect(a).toEqual(c)
			const commitDataC = await ormC('CommitData').findOne()
			// total 900 commits
			expect(commitDataC.highestCommitId).toBe(300)
			expect(commitDataC.syncData.needReSync).toBe(false)
			done()
		})
		ormA.startSyncSnapshot()
	}, 80000)

	it('Case 3: Client create commit during snapshot progress', async (done) => {
		await ormA('Model').create({ table: 8 })
		await ormA('Model').create({ table: 10})
		await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		ormA.on('snapshot-done', async () => {
			await ormC('Model').updateOne({ table: 10 }, { name: 'Updated'} )
			ormC.emit('initSyncForClient', s2)
			ormA.emit('master:transport:sync')
			await delay(15000)
			const commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			const commitsC = await ormC('Commit').find()
			expect(stringify(commitsC)).toMatchSnapshot()
			const a = await ormA('Model').find({ table: 10 })
			const c = await ormC('Model').find({ table: 10 })
			expect(stringify(a)).toMatchSnapshot()
			delete a[0].snapshot
			expect(a).toEqual(c)
			done()
		})
		ormA.startSyncSnapshot()
		await delay(50)
	}, 80000)

	it('Case 4: Snapshot twice, but only 1 order is recreated', async () => {
		const a = await ormA('Model').create({ table: 10, items: [] })
		await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		let m1 = await ormA('Model').find({ table: 10 })
		let m2 = await ormB('Model').find({ table: 10 })
		await new Promise(resolve => {
			const interval = setInterval(async () => {
				m1 = await ormA('Model').find({ table: 10 })
				m2 = await ormB('Model').find({ table: 10 })
				if (m1.toString() === m2.toString()) {
					clearInterval(interval)
					resolve()
				}
			}, 2000)
		})
		expect(m1).toEqual(m2)
		ormA.startSyncSnapshot()

		ormA.on('snapshot-done', async () => {
			await delay(200)
			const commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			const commitsB = await ormB('Commit').find()
			expect(stringify(commitsB)).toMatchSnapshot()

		})
	}, 80000)

	it('Case 5: Delete only commit of manipulated doc', async (done) => {
		await ormA('Model').create({ table: 10 })
		await ormA('Model').create({ table: 9 })
		ormA.once('snapshot-done', async () => {
			await delay(50)
			let commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
			await ormA('Model').create({ table: 11 })
			await delay(50)
			commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			ormA.once('snapshot-done', async () => {
				const commitsA = await ormA('Commit').find()
				expect(stringify(commitsA)).toMatchSnapshot()
				done()
			})
			ormA.startSyncSnapshot()
		})
		ormA.startSyncSnapshot()
	}, 30000)

	it('Case 6: Delete document', async (done) => {
		await ormA('Model').create({ table: 10, name: 'abc' })
		await ormA('Model').create({ table: 9 })
		await ormA.startSyncSnapshot()
		await ormA('Model').deleteOne({ table: 10 })
		ormA.once('snapshot-done', async () => {
			await delay(50)
			let commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			await ormA('Model').create({ table: 11 })
			await delay(50)
			commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			done()
		})
		ormA.startSyncSnapshot()
	}, 30000)

	it('Case 6a: Delete multi documents', async (done) => {
		await ormA('Model').create({ table: 10, name: 'abc' })
		await ormA('Model').create({ table: 9 })
		await ormA.startSyncSnapshot()
		await ormA('Model').deleteMany({})
		ormA.once('snapshot-done', async () => {
			await delay(50)
			let commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			await ormA('Model').create({ table: 11 })
			await delay(50)
			commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			done()
		})
		ormA.startSyncSnapshot()
	}, 30000)
})
