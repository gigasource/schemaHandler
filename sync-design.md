* [_] standard behaviour: 
    * [_] tạo fake -> đợi sync:require -> xoá fake -> sync commit từ master rồi action theo các commit đó ???
    * [_]  
* [_] Resolve conflict on master 

* [_] flow for commit handler customize:
* [_] 

* what do user care:


``` javascript
let flow;
//on client
flow.on('pre:execChain', '@cb').hasCommitAtLast().makeCommit().expect('')
.once('proxyPreReturnValue', '@cb').buildFake()
.to('::master').emit('commitRequest')
.return().return()

flow.on('require:sync', '@cb').removeFake()

//on Master
flow.on('commitRequest', '@cb->scope').handlerCommit('@');
flow.on('newCommit', '@cb').requireSync();

flow.on('pre:execChain', '@cb').makeCommit()
.once('proxyPreReturnValue', '@cb')
.emit('commitRequest')
.return().return()
```
