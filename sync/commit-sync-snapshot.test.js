const Orm = require('../orm')
const { stringify } = require("../utils");
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

describe('commit-sync-snapshot', function () {
	beforeAll(async () => {
		ormA.connect({ uri: "mongodb://localhost:27017" }, "myproject1")
		ormB.connect({ uri: "mongodb://localhost:27017" }, "myproject2")
		ormC.connect({ uri: "mongodb://localhost:27017" }, "myproject3")

		const orms = [ormA, ormB, ormC]

		for (const orm of orms) {
			orm.plugin(require('./sync-plugin-multi'))
			orm.plugin(require('./sync-transporter'))
			orm.plugin(require('./sync-snapshot'))
			orm.setSyncCollection('Model')
		}

		ormA.plugin(require('./sync-flow'), 'master')
		ormB.plugin(require('./sync-flow'), 'client')
		ormC.plugin(require('./sync-flow'), 'client')

		ormA.setUnsavedCommitCollection('Model')
		ormB.setUnsavedCommitCollection('Model')
		ormC.setUnsavedCommitCollection('Model')

		ormB.emit('initSyncForClient', s1)
		masterIo.on('connect', (socket) => {
			ormA.emit('initSyncForMaster', socket)
		})

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
	})

	it('Case 1: Client with highest commit id sync with master', async (done) => {
		const a = await ormA('Model').create({ table: 10, items: [] })
		await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		await delay(50)
		const m1 = await ormA('Model').find({ table: 10 })
		const m2 = await ormB('Model').find({ table: 10 })
		expect(m1).toEqual(m2)
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
		await ormA('Model').create({ table: 10})
		await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		ormA.on('snapshot-done', async () => {
			ormC.emit('initSyncForClient', s2)
			ormA.emit('master:transport:sync')
			await delay(1000)
			const commitsA = await ormA('Commit').find()
			expect(stringify(commitsA)).toMatchSnapshot()
			const commitsC = await ormC('Commit').find()
			expect(stringify(commitsC)).toMatchSnapshot()
			const a = await ormA('Model').find({ table: 10 })
			const c = await ormC('Model').find({ table: 10 })
			expect(a).toEqual(c)
			done()
		})
		ormA.startSyncSnapshot()
		await delay(50)
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
			expect(a).toEqual(c)
			expect(stringify(a)).toMatchSnapshot()
			done()
		})
		ormA.startSyncSnapshot()
		await delay(50)
	}, 80000)

	it('Case 4: Snapshot twice, but only 1 order is recreated', async () => {
		const a = await ormA('Model').create({ table: 10, items: [] })
		await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		await delay(50)
		const m1 = await ormA('Model').find({ table: 10 })
		const m2 = await ormB('Model').find({ table: 10 })
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

	it('Case 4: Delete only commit of manipulated doc', async (done) => {
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
})
