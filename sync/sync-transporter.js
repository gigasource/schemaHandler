const AwaitLock = require('await-lock').default;

module.exports = function (orm) {
	//todo: layer transport implement
	orm.on('initSyncForClient', (clientSocket, dbName) => {
		const requireSyncLock = new AwaitLock()
		orm.onQueue('transport:toMaster', async commit => {
			clientSocket.emit('commitRequest', commit)
		})

		clientSocket.on('transport:sync', async () => {
			// orm.emit('transport:sync');
			const {value: highestId} = await orm.emit('getHighestCommitId');
			orm.emit('transport:require-sync', highestId);
		})

		orm.on('transport:require-sync', (highestId) => {
			if (!requireSyncLock.tryAcquire()) return
			requireSyncLock.acquire()
			const args = [highestId];
			orm.emit('commit:sync:args', args);
			clientSocket.emit('transport:require-sync', args, async (commits) => {
				await orm.emit('transport:requireSync:callback', commits)
			})
			requireSyncLock.release()
		})
	})

	orm.on('initSyncForMaster', socket => {
			socket.on('commitRequest', async (commit) => {
				const { value: _commit } = await orm.emit('process:commit', commit)
				if (_commit) {
					await orm.emit('createCommit', _commit);
				}
			});

			socket.on('transport:require-sync', async function ([clientHighestId = 0, dbName], cb) {
				const {value: commits} = await orm.emit('commit:sync:master', clientHighestId, dbName);
				cb(commits);
			})
	})

	orm.on('initSyncForCloud', cloudIo => {
		cloudIo.on('transport:sync', highestId => {
		})
	})

	//should transparent
	orm.onQueue('transport:requireSync:callback', async function (commits) {
		for (const commit of commits) {
			//replace behaviour here
			try {
				await orm('Commit').create(commit);
				await orm.emit('commit:flow:handler', commit);
			} catch (e) {
				if (e.message.slice(0, 6)) {
					console.log('sync two fast')
				}
			}
		}
	})
}
