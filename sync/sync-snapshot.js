const AwaitLock = require('await-lock').default;
const uuid = require('uuid')
const {ObjectID} = require('bson')
const jsonFn = require('json-fn')

module.exports = function (orm) {
	const syncLock = new AwaitLock()
	const handlers = []
	const unusedCollections = ['DummyCollection']
	let SNAPSHOT_COMMIT_CACHE = 300

	orm.getSnapshotCollection = getSnapshotCollection

	const snapshotCollection = []
	function getSnapshotCollection() {
		return snapshotCollection
	}

	async function createCommitCache() {
		await orm.emit('createCommit', { collectionName: 'DummyCollection', uuid: uuid.v4() })
		const cachedCommits = await orm('Commit').find().sort({ id: -1 }).limit(SNAPSHOT_COMMIT_CACHE)
		cachedCommits.reverse()
		await orm('CommitCache').deleteMany({})
		await orm('CommitCache').create(cachedCommits)
	}

	function cleanDoc(doc) {
		if (doc.__ss)
			delete doc.__ss
		if (doc.__r)
			delete doc.__r
	}

	orm.onQueue('createCommitSnapshot', async function (commits) {
		// remember to lock sync before calling this
		if (!commits.length) return
		let data = {}
		let highestCommitId = 0
		for (let commit of commits) {
			if (!data[commit.collectionName]) {
				data[commit.collectionName] = []
			}
			const doc = jsonFn.parse(commit.chain)[0].args[0]
			delete commit.chain
			commit.ref = commit.data.docId
			highestCommitId = Math.max(highestCommitId, commit.id)
			data[commit.collectionName].push(doc)
		}
		const keys = Object.keys(data)
		for (let key of keys) {
			await orm(key).create(data[key]).direct()
		}
		await orm('Commit').create(commits)
		await orm('CommitData').updateOne({}, {
			highestCommitId
		})
	})

	orm.on('commit:setSnapshotCache', value => SNAPSHOT_COMMIT_CACHE = value)

	// only for master
	orm.on('transport:require-sync:preProcess', async function (clientHighestId, syncAll = false) {
		if (!this.value) this.value = []
		const foundCommit = await orm('CommitCache').findOne({ id: clientHighestId })
		if (foundCommit) {
			const additionalCondition = syncAll ? {} : {collectionName: { $nin: orm.getUnwantedCol() }}
			this.value.push(...(await orm('CommitCache').find({
				id: {$gt: clientHighestId},
				...additionalCondition
			}).sort({ id: 1 })))
		}
	})

	orm.on('transport:require-sync:postProcess', async function (commits) {
		if (!this.value) {
			this.value = {}
		}
		const docsSnapshot = {}
		let colsId = {}
		commits.map(commit => {
			if (commit.ref) {
				if (!colsId[commit.collectionName]) colsId[commit.collectionName] = []
				colsId[commit.collectionName].push(commit.ref)
			}
		})
		const cols = Object.keys(colsId)
		for (let col of cols) {
			docsSnapshot[col] = await orm(col).find({ _id: { $in: colsId[col] } }).noEffect()
		}
		const mapDocs = {}
		Object.keys(docsSnapshot).forEach(col => {
			docsSnapshot[col].forEach(doc => {
				mapDocs[doc._id.toString()] = doc
			})
		})
		for (let commit of commits) {
			if (commit.ref) {
				const doc = mapDocs[commit.ref.toString()]
				if (!doc) {
					commit.chain = null
				} else {
					cleanDoc(doc)
					commit.chain = jsonFn.stringify(orm(commit.collectionName).insertOne(doc).chain)
				}
			}
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
		snapshotCollection.push(collection)
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
			const doc = await orm(collection).findOne({ _id: commit.data.docId }).direct().noEffect()
			if (!doc) {
				this.setValue(false)
			} else {
				if (!doc.__c) doc.__c = 0
				if (commit.__c === undefined) { // handle old snapshot commit with no _cnt
					await orm(collection).deleteOne({_id: commit.data.docId}).direct()
					await orm('Recovery' + collection).deleteOne({_id: commit.data.docId})
					this.setValue(false)
				} else if (doc.__c !== commit.__c) {
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
			if (!orm.isMaster() || !['do', 'dm', 'r', 'ro'].includes(commit._c))
				return
			if (!commit.condition)
				commit.condition = '{}'
			if (!commit.data)
				commit.data = {}
			const parsedCondition = jsonFn.parse(commit.condition)
			const deletedDoc = []
			if (['do', 'ro'].includes(commit._c)) {
				const foundDoc = await orm(collection).findOne(parsedCondition).noEffect()
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
				deletedDoc.push(...await orm(collection).find(parsedCondition).noEffect())
			}
			commit.data.snapshot = true
			commit.data.deletedDoc = deletedDoc.map(doc => doc._id)
		})

		orm.on(`process:commit:${collection}`, 1, async function (commit, target) {
			if (commit.data.snapshot || !commit.condition || !orm.isMaster())
				return
			const condition = commit.condition ? jsonFn.parse(commit.condition) : {}
			const refDoc = await orm(collection).find({ __r: true, ...condition }).noEffect()
			const raws = []
			const colRaws = []
			for (let doc of refDoc) {
				cleanDoc(doc)
				const chain = jsonFn.stringify(orm(collection).insertOne(doc).chain)
				raws.push(await orm('Commit').updateOne({ ref: doc._id },
					{ $set: { chain: chain }, $unset: { ref: ''} }).batch())
				colRaws.push(await orm(collection).updateOne({ _id: doc._id }, { $unset: { __r: '' } }).batch())
			}
			try {
				if (raws.length) {
					await orm('Commit').bulkWrite(raws)
					await orm(collection).bulkWrite(colRaws).direct()
				}
			} catch (err) {
				console.error('Error while processing commit in sync')
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
					{ __r: true }
				).direct()
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
			if (!orm.createQuery.includes(commit._c)) {
				let condition = jsonFn.parse(commit.condition)
				if (!condition)
					condition = {}
				condition._arc = { $exists: false }
				await orm(collection).updateMany(condition, { __ss: true }).direct()
			} else {
				if (result && Array.isArray(result)) {
					console.log('[Snapshot] case create many')
					const _ids = result.map(doc => doc._id)
					await orm(collection).updateMany({ _id: { $in: _ids } }, { __ss: true }).direct()
				} else if (result) {
					await orm(collection).updateOne({ _id: result._id }, { __ss: true }).direct()
				}
			}
		})

		const startSnapshot = async function () {
			if (!orm.isMaster()) return
			const { syncData } = await orm('CommitData').findOne()
			await orm('Commit').deleteMany({ collectionName: collection, 'data.snapshot': {$exists: false } })
			if (syncData.firstTimeSync)
				await orm(collection).updateMany({ __arc: { $exists: false }}, { __ss: true }).direct()
			while (true) {
				const doc = await orm(collection).findOne({ __ss: true }).noEffect()
				if (!doc)
					break
				delete doc.__ss
				await orm('Commit').deleteMany({ 'data.docId': doc._id, 'data.snapshot': true })
				await orm.emit('createCommit', {
					_id: new ObjectID(),
					collectionName: collection,
					data: {
						snapshot: true,
						docId: doc._id,
					},
					__c: doc.__c ? doc.__c : 0,
					ref: doc._id
				})
				await orm(collection).updateOne({ _id: doc._id }, { $unset: {__ss: ''} }).direct()
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
