const AwaitLock = require('await-lock').default;

module.exports = function (orm) {
	const queueLock = new AwaitLock()
	let isMaster = (orm.mode === 'multi' ? {} : false)

	orm.on('commit:flow:setMaster', function (_isMaster, dbName) {
		if (dbName) {
			isMaster[dbName] = _isMaster
		} else {
			isMaster = _isMaster
		}
	})

	const checkMaster = (dbName) => {
		return dbName ? isMaster[dbName] : isMaster
	}

	orm.isMaster = checkMaster

	orm.plugin(require('./sync-transporter'))

	// customize
	orm.onDefault('commit:flow:execCommit', async (query, target, exec, commit) => {
		await queueLock.acquireAsync()
		if (orm.mode === 'multi' && !commit.dbName) {
			console.warn('commit.dbName is undefined')
			queueLock.release()
			return
		}
		const { value: _commit } = await orm.emit('process:commit', commit)
		if (!_commit) {
			queueLock.release()
			return
		}
		// if (_commit.chain !== commit.chain) {
		// 	exec = async () => await orm.execChain(getQuery(_commit))
		// }
		// commit = _commit
		let value
		if (!checkMaster(commit.dbName)) {
			// client
			orm.emit('transport:toMaster', commit)
			await orm.emit('commit:build-fake', query, target, exec, commit, e => eval(e))
		} else {
			const lock = new AwaitLock()
			await lock.acquireAsync()
			orm.once(`commit:result:${commit.uuid}`, function (result) {
				value = result
				lock.release()
			})
			orm.emit('createCommit', commit)
			await lock.acquireAsync()
		}
		this.value = value
		queueLock.release()
	})

	//customize
	orm.onQueue('commit:flow:handler', async commit => {
		await orm.emit('commit:remove-fake', commit);
		// await orm.execChain(getQuery(commit));
		await orm.emit('createCommit', commit)
		orm.emit('commit:handler:finish');
	})
}
