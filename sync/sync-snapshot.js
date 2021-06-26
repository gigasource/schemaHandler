const AwaitLock = require('await-lock').default;
const uuid = require('uuid')

module.exports = function (orm) {
	const syncLock = new AwaitLock()
	const handlers = []
	const unusedCollections = []

	async function createCommitCache() {
		const cachedCommits = await orm('Commit').find().sort({ id: -1 }).limit(300)
		await orm('CommitCache').deleteMany({})
		await orm('CommitCache').create(cachedCommits)
	}

	// only for master
	orm.on('transport:require-sync:preProcess', async function (clientHighestId) {
		if (!this.value) this.value = []
		const foundCommit = await orm('CommitCache').findOne({ id: clientHighestId })
		if (foundCommit) {
			this.value.push(...(await orm('CommitCache').find({id: {$gt: clientHighestId}}).sort({ id: 1 })))
		}
	})

	orm.setUnusedCollection = function (collections) {
		unusedCollections.push(...collections)
	}

	orm.setSyncCollection = function (collections) {
		if (Array.isArray(collections)) {
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
				if (syncData.needReSync) {
					await orm(collection).deleteOne({_id: commit.data.docId}).direct()
				}
				return this.mergeValueAnd(!syncData.needReSync)
			} else {
				const currentHighestUUID = commit.data.currentHighestUUID

				// because command create has been ran, so the second highest id commit
				// will be the one with uuid we are looking for
				const highestCommits = await orm('Commit').find({}).sort({ id: - 1}).limit(2)
				const _syncData = {
					id: commit.data.syncUUID,
					needReSync: true
				}
				if (highestCommits.length > 1 && highestCommits[1].uuid === currentHighestUUID) {
					_syncData.needReSync = false
				}
				await orm('CommitData').updateOne({}, { syncData: _syncData }, { upsert: true })
				if (_syncData.needReSync) {
					await orm(collection).deleteOne({_id: commit.data.docId}).direct()
				}
				return this.mergeValueAnd(!_syncData.needReSync)
			}
		})

		orm.on(`process:commit:${collection}`, async function (commit, target) {
			// deleteOne must be used with specific condition such as _id
			if (!target || (!target.cmd.includes('delete') && !target.cmd.includes('remove')))
				return
			if (!commit.condition)
				commit.condition = {}
			const deletedDoc = await orm(collection).find(JSON.parse(commit.condition))
			if (!commit.data)
				commit.data = {}
			commit.data.snapshot = true
			commit.data.deletedDoc = deletedDoc.map(doc => doc._id)
		})

		// add lastTimeModified field
		orm.on(`commit:handler:finish:${collection}`, -1, async function (result, commit) {
			if (commit.data && commit.data.snapshot) {
				if (commit.data.deletedDoc) {
					await orm('Commit').deleteMany({'data.docId': {$in: commit.data.deletedDoc}, 'data.snapshot': true})
				}
				return
			}
			if (!orm.isMaster()) return
			if (commit.condition)
				await orm(collection).updateOne(JSON.parse(commit.condition), { snapshot: true }).direct()
			else if (commit.data && commit.data.docId)
				await orm(collection).updateOne({ _id: commit.data.docId }, { snapshot: true }).direct()
		})

		const startSnapshot = async function () {
			if (!orm.isMaster()) return
			const { syncData } = await orm('CommitData').findOne()
			const currentHighestUUID = (await orm('Commit').find().sort({ id: -1 }).limit(1))[0].uuid
			await orm('Commit').deleteMany({ collectionName: collection, 'data.snapshot': {$exists: false } })
			if (syncData.firstTimeSync)
				await orm(collection).updateMany({}, { snapshot: true }).direct()
			while (true) {
				const doc = await orm(collection).findOne({ snapshot: true })
				if (!doc)
					break
				delete doc.snapshot
				await orm('Commit').deleteMany({ 'data.docId': doc._id, 'data.snapshot': true })
				await orm(collection).deleteOne({ _id: doc._id }).direct()
				await orm(collection).create(doc).commit({ currentHighestUUID, syncUUID: syncData.id, snapshot: true })
			}
		}

		handlers.push(startSnapshot)
	}

	orm.checkSnapshotProgress = async function () {
		if (!orm.isMaster()) return
		const commitData = await orm('CommitData').findOne({})
		if (!commitData)
			return
		const { syncData } = commitData
		if (syncData && syncData.isSyncing) {
			await orm.startSyncSnapshot()
		}
	}

	orm.startSyncSnapshot = async function () {
		if (syncLock.acquired)
			return
		syncLock.tryAcquire()
		console.log(`[Snapshot] Start snapshot ${new Date()}`)
		try {
			const oldCommitData = await orm('CommitData').findOne()
			const syncData = {
				id: uuid.v4(),
				isSyncing: true,
				firstTimeSync: !(oldCommitData && oldCommitData.syncData)
			}
			console.log('[Snapshot] Is first time sync', syncData.firstTimeSync)
			await createCommitCache()
			await orm('CommitData').updateOne({}, {syncData}, {upsert: true})
			for (let collection of unusedCollections) {
				await orm('Commit').deleteMany({ collectionName: collection })
			}
			const promises = []
			for (const handler of handlers) {
				promises.push(handler())
			}
			await Promise.all(promises)
			await orm('CommitData').updateOne({}, {$set: {syncData: {isSyncing: false}}})
		} catch (err) {
			console.error(err)
		}
		syncLock.release()
		console.log(`[Snapshot] Finish snapshot ${new Date()}`)
		orm.emit('master:transport:sync')
		orm.emit('snapshot-done')
	}
}
