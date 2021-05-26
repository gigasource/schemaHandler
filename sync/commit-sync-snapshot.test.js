const Orm = require('../orm')
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
		}

		ormA.plugin(require('./sync-flow'), 'master')
		ormB.plugin(require('./sync-flow'), 'client')
		ormC.plugin(require('./sync-flow'), 'client')

		ormB.emit('initSyncForClient', s1)
		ormC.emit('initSyncForClient', s2)
		masterIo.on('connect', (socket) => {
			ormA.emit('initSyncForMaster', socket)
		})

		s1.connect('local')
		s2.connect('local')

		for (let orm of orms) {
			await orm('Model').remove({})
			await orm('Commit').remove({})
			await orm('Recovery').remove({})
		}

		for (const orm of orms) {
			orm.registerSchema('Model', {
				items: [{}]
			})
			orm.registerCommitBaseCollection('Model')
		}
	})

	it('Case 1: Client with highest commit id sync with master', async (done) => {
		await ormA('Model').create({ table: 10, items: [] })
		await ormA('Model').updateOne({ table: 10 }, { name: 'Testing' })
		await delay(50)
		const m2 = await ormB('Model').find({ table: 10 })
		expect(m1).toEqual(m2)
		ormA.startSnapshot()

		ormA.on('snapshot-done', async () => {
			await delay(50)
			const commitsA = await ormA('Commit').find()
			expect(commitsA).toMatchSnapshot()
			const commitsB = await ormB('Commit').find()
			expect(commitsB).toMatchSnapshot()
			done()
		})
	})
})
