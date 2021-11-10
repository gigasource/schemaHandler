const AwaitLock = require('await-lock').default;
const uuid = require('uuid')
const {ObjectID} = require('bson')
const jsonFn = require('json-fn')

module.exports = function (orm) {
	const syncLock = new AwaitLock()
	const handlers = []
	const unusedCollections = ['DummyCollection']
	let SNAPSHOT_COMMIT_CACHE = 300

	async function createCommitCache() {
		await orm.emit('createCommit', { collectionName: 'DummyCollection', uuid: uuid.v4() })
		const cachedCommits = await orm('Commit').find().sort({ id: -1 }).limit(SNAPSHOT_COMMIT_CACHE)
		cachedCommits.reverse()
		await orm('CommitCache').deleteMany({})
		await orm('CommitCache').create(cachedCommits)
	}

	function cleanDoc(doc) {
		if (doc.snapshot)
			delete doc.snapshot
		if (doc.ref)
			delete doc.ref
	}

	orm.on('commit:setSnapshotCache', value => SNAPSHOT_COMMIT_CACHE = value)

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
			if (commit.data.deletedDoc) {
				const chain = orm(collection).deleteMany({ _id: { $in: commit.data.deletedDoc } }).chain
				commit.chain = JSON.stringify(chain)
				return this.mergeValueAnd(false)
			}
			const doc = await orm(collection).findOne({ _id: commit.data.docId }).direct()
			if (!doc) {
				this.setValue(false)
			} else {
				if (!doc._cnt) doc._cnt = 0
				if (commit._cnt === undefined) { // handle old snapshot commit with no _cnt
					await orm(collection).deleteOne({_id: commit.data.docId}).direct()
					await orm('Recovery' + collection).deleteOne({_id: commit.data.docId})
					this.setValue(false)
				} else if (doc._cnt !== commit._cnt) {
					// need resync
					await orm(collection).deleteOne({_id: commit.data.docId}).direct()
					await orm('Recovery' + collection).deleteOne({_id: commit.data.docId})
					this.setValue(false)
				} else {
					this.setValue(true)
				}
				this.stop()
			}
		})

		orm.on(`process:commit:${collection}`, async function (commit, target) {
			// deleteOne must be used with specific condition such as _id
			if (!target || (!target.cmd.includes('delete') && !target.cmd.includes('remove')))
				return
			if (!commit.condition)
				commit.condition = '{}'
			if (!commit.data)
				commit.data = {}
			const parsedCondition = jsonFn.parse(commit.condition)
			const deletedDoc = []
			if (target.cmd.includes('One')) {
				const foundDoc = await orm(collection).findOne(parsedCondition)
				if (foundDoc) {
					deletedDoc.push(foundDoc)
					if (!parsedCondition._id) {
						parsedCondition._id = foundDoc._id
						commit.condition = jsonFn.stringify(parsedCondition)
						commit.data.addId = true
						commit.chain = jsonFn.stringify(orm(collection).deleteOne(parsedCondition).chain)
					}
				}
			} else {
				deletedDoc.push(...await orm(collection).find(parsedCondition))
			}
			commit.data.snapshot = true
			commit.data.deletedDoc = deletedDoc.map(doc => doc._id)
		})

		orm.on(`process:commit:${collection}`, 1, async function (commit, target) {
			if (!target || commit.data.snapshot || !commit.condition)
				return
			const condition = commit.condition ? jsonFn.parse(commit.condition) : {}
			const refDoc = await orm(collection).find({ ref: true, ...condition })
			for (let doc of refDoc) {
				cleanDoc(doc)
				const chain = jsonFn.stringify(orm(collection).create(doc).chain)
				await orm('Commit').updateOne({ ref: doc._id },
					{ chain, $unset: { ref: ''} })
				await orm(collection).updateOne({ _id: doc._id }, { $unset: { ref: '' } }).direct()
			}
		})

		/**
		 * Master will remove chain data
		 */
		orm.on(`commit:handler:finish:${collection}`, -2, async function (result, commit) {
			if (!orm.isMaster() || !commit.data.snapshot || commit.data.deletedDoc) return
			if (commit.data.docId) {
				await orm('Commit').updateOne(
					{ _id: commit._id },
					{
						ref: commit.data.docId,
						$unset: {
							chain: ''
						}
					}
				)
				await orm(collection).updateOne(
					{ _id: commit.data.docId },
					{ ref: true }
				).direct()
			}
		})

		orm.on('transport:require-sync:postProcess', async function (commits) {
			for (let commit of commits) {
				if (commit.ref) {
					const doc = await orm(commit.collectionName).findOne({ _id: commit.ref })
					doc && cleanDoc(doc)
					if (!doc) {
						commit.chain = null
					} else {
						commit.chain = jsonFn.stringify(orm(commit.collectionName).create(doc).chain)
					}
				}
			}
		})

		// add lastTimeModified field
		orm.on(`commit:handler:finish:${collection}`, -1, async function (result, commit) {
			if (commit.data && commit.data.snapshot) {
				if (commit.data.deletedDoc) {
					// master always creates snapshot, so data.docId is ObjectID
					await orm('Commit').deleteMany({'data.docId': {$in: commit.data.deletedDoc},
						'data.snapshot': true, 'data.deletedDoc': {$exists: false}})
				}
				return
			}
			if (!orm.isMaster()) return
			if (!orm.createQuery.includes(orm.shorthand[commit._c])) {
				const condition = jsonFn.parse(commit.condition)
				condition._arc = { $exists: false }
				await orm(collection).updateMany(condition, { snapshot: true }).direct()
			} else {
				if (result && Array.isArray(result)) {
					console.log('[Snapshot] case create many')
					for (let doc of result)
						await orm(collection).updateOne({ _id: doc._id }, { snapshot: true }).direct()
				} else if (result) {
					await orm(collection).updateOne({ _id: result._id }, { snapshot: true }).direct()
				}
			}
		})

		const startSnapshot = async function () {
			if (!orm.isMaster()) return
			const { syncData } = await orm('CommitData').findOne()
			await orm('Commit').deleteMany({ collectionName: collection, 'data.snapshot': {$exists: false } })
			if (syncData.firstTimeSync)
				await orm(collection).updateMany({ _arc: { $exists: false }}, { snapshot: true }).direct()
			while (true) {
				const doc = await orm(collection).findOne({ snapshot: true })
				if (!doc)
					break
				delete doc.snapshot
				await orm('Commit').deleteMany({ 'data.docId': doc._id, 'data.snapshot': true })
				await orm.emit('createCommit', {
					_id: new ObjectID(),
					collectionName: collection,
					data: {
						syncUUID: syncData.id,
						snapshot: true,
						docId: doc._id,
					},
					_cnt: doc._cnt ? doc._cnt : 0,
					ref: doc._id,
					fromMaster: true,
					uuid: uuid.v4()
				})
				await orm(collection).updateOne({ _id: doc._id }, { $unset: {snapshot: ''} }).direct()
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
			orm.emit('commit:setUseCacheStatus', false)
			await createCommitCache()
			await orm('CommitData').updateOne({}, {syncData}, {upsert: true})
			for (let collection of unusedCollections) {
				await orm(collection).deleteMany({}).direct()
				await orm('Commit').deleteMany({ collectionName: collection })
			}
			const promises = []
			for (const handler of handlers) {
				promises.push(handler())
			}
			await Promise.all(promises)
			await orm('CommitData').updateOne({}, {'syncData.isSyncing': false})
		} catch (err) {
			console.error(err)
		}
		syncLock.release()
		console.log(`[Snapshot] Finish snapshot ${new Date()}`)
		orm.emit('commit:setUseCacheStatus', true)
		orm.emit('master:transport:sync')
		orm.emit('snapshot-done')
	}
}
