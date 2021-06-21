const AwaitLock = require('await-lock').default;
const uuid = require('uuid')

module.exports = function (orm) {
	const syncLock = new AwaitLock()
	const handlers = []

	orm.setSyncCollection = function (collections) {
		if (typeof collections === 'array') {
			for (const collection of collections)
				orm._setSyncCollection(collection)
		} else {
			orm._setSyncCollection(collections)
		}
	}

	orm._setSyncCollection = function (collection) {
		// for client to check whether run commit or not
		orm.on(`commit:handler:shouldNotExecCommand:${collection}`, async function (commit) {
			if (orm.isMaster() || !commit.data.snapshot) {
				return this.mergeValueAnd(false)
			}
			const { syncData } = await orm('CommitData').findOne()
			if (syncData && syncData.id === commit.data.syncUUID) {
				return this.mergeValueAnd(!syncData.needReSync)
			} else {
				const currentHighestUUID = commit.data.currentHighestUUID

				// client only has highest id commit
				const highestCommit = await orm('Commit').findOne()
				const _syncData = {
					id: commit.data.syncUUID,
					needReSync: true
				}
				if (highestCommit.uuid === currentHighestUUID) {
					_syncData.needReSync = false
				}
				await orm('CommitData').updateOne({}, { syncData: _syncData }, { upsert: true })
				return this.mergeValueAnd(!_syncData.needReSync)
			}
		})

		orm.on(`process:commit:${collection}:snapshot`, async function (commit) {
			if (!commit.data || !commit.data.snapshot) return
			await orm(collection).deleteOne({ _id: commit.data.docId }).direct()
		})

		// add lastTimeModified field
		orm.on(`commit:handler:finish:${collection}`, -1, async function (result, commit) {
			if ((commit.data && commit.data.snapshot)) return
			if (commit.condition)
				await orm(collection).updateOne(JSON.parse(commit.condition), { snapshot: true }).direct()
			else if (commit.data && commit.data.docId)
				await orm(collection).updateOne({ _id: commit.data.docId }, { snapshot: true }).direct()
		})

		const startSnapshot = async function () {
			if (!orm.isMaster()) return
			orm.emit('block-sync', collection)
			const { syncData } = await orm('CommitData').findOne()
			const currentHighestUUID = (await orm('Commit').find().sort({ id: -1 }).limit(1)).uuid
			await orm('Commit').deleteMany({ collectionName: collection, 'data.snapshot': {$exists: false } })
			if (syncData.firstTimeSync)
				await orm(collection).updateMany({}, { snapshot: true }).direct()
			while (true) {
				const doc = await orm(collection).findOne({ snapshot: true })
				if (!doc)
					break
				delete doc.snapshot
				await orm('Commit').deleteMany({ 'data.docId': doc._id, 'data.snapshot': true })
				await orm(collection).create(doc).commit(`${collection}:snapshot`, { currentHighestUUID, syncUUID: syncData.id, snapshot: true })
			}
		}

		handlers.push(startSnapshot)
	}

	orm.checkSnapshotProgress = async function () {
		if (!orm.isMaster()) return
		const { syncData } = await orm('CommitData').findOne()
		if (syncData.isSyncing) {
			await orm.startSyncSnapshot()
		}
	}

	orm.startSyncSnapshot = async function () {
		if (syncLock.acquired)
			return
		syncLock.tryAcquire()
		const oldCommitData = await orm('CommitData').findOne()
		const syncData = {
			id: uuid.v4(),
			isSyncing: true,
			firstTimeSync: !(oldCommitData && oldCommitData.syncData)
		}
		await orm('CommitData').updateOne({}, { syncData }, { upsert: true })
		const promises = []
		for (const handler of handlers) {
			promises.push(handler())
		}
		await Promise.all(promises)
		await orm('CommitData').updateOne({}, { $set: { syncData: { isSyncing: false } } })
		syncLock.release()
		orm.emit('master:transport:sync')
		orm.emit('snapshot-done')
	}

	orm.on('block-sync', function () {
		this.mergeValueAnd(syncLock.acquired)
	})
}