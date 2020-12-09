* [_] standard behaviour:
    * [_] tạo fake -> đợi sync:require -> xoá fake -> sync commit từ master rồi action theo các commit đó ???
    * [_]
* [_] Resolve conflict on master
* [x] Tạo fake + recovery
  [x] client should create commit with approve = false
  [x] test recovery : remove one doc instead of all _fake
  [x] behaviour should be like master ??

* [x] flow for commit handler customize:
* [x] split logic for master + client
* [x] use lock for time step (flow)
* [x] default là commit, direct
  [x] hooks : support stop
  [x] hooks : hooks.on(event, -5, listener);

* [_] socket io || cloud base ??

* [_] case 1: cloud backup :
    * [_] master emit commit to cloud : easy

* [x] case 2: cloud is master : multi-db:
    * [x] assign dbName to commit !!!

* [_] case 3 : no master, cloud only backup ??

* [_] case 4: client + master + cloud backup
    * [_] cloud back up is like one client not more

* [_] flow: sync -> use for simulate
* [_] socket io simulate
    * [_] emit/on layer
    * [_] connect
    * [_] disconnect
    * [_] emitTo() / on()
    * [_] addable logic over hooks system

```javascript

const socket = createClient();
const io = createServer('domain');
socket.connect('domain');
io.on('connect', socket => {
  //socket
})

socket.emit(['clientId', 'event'], arg1, arg2, arg3, cb);
socket.emitTo(['clientId', 'event'], arg1, arg2, arg3, [cb, 'arg', 'arg2', e => eval(e)]);
socket.hooks.emit();

socket.connect('localhost')
socket.emit('', cb)

io.on('connect', socket => {
  socket.emit();
})

socket.emit('abc')

```

* what do user care:

// tat bat duoc, mock duoc, code tap trung duoc // change duoc trong realtime

* case master:
* case client:
* case without cloud:

* [_] test one process with two orm client /master
* [_] test one process with only master

* [_] use flow for re-design the concept
* [_] trace system easy for programming (event base is too complex for navigate)
* [_] flow like concept

problem: callback will be called multi times, but async await only one time how to mock : on can't be mocked, only once;
concept to use generator to solve a callback for trace ??

```javascript
    orm.onFlatten('pre:execChain', callback);

async function callback() {
  const [query] = await orm.once('pre:execChain', '@cb');
  const [_query, target, exec] = await orm.once(`proxyPreReturnValue:${query.uuid}`, '@cb');
  await orm.emit('commit:build-fake');
}
```

how to make callback be called in this case:

```javascript
function* flow() {
  do1();
  const query = yield orm.on('pre:execChain');
  do2();
  const result = yield orm.on('toMaster');
}

```

-> debug problem:

//hooks persistent , one time emit, serializable

```javascript
const val = 10;
hooks.emitStringify('test', function () {
  console.log(val);
}, ['val'], e => eval(e));
```

```javascript
//low level
const {confirm} = hooks.emitRetry('test', lastAck);

hooks.onRetryLowLevel('test', (arg1, {ack, cb}) => {
  cb(); // run on pre
  ack();
})

hooks.onRetry('test', cb => {
  doA();
  cb();
})

//problem doA can run multiple times with retry 
``` 

orm.register('init',() => { orm.on('A', doA()); orm.on('B', doB()); orm.on('C', doC()); })

orm.unregister('init');

client :
CommitRequest:
clientId: name of client id : 1, 2, 3 ... Commit:
clientId: name of client clientCommitId: link to id CommitRequest Recovery :
commitRequestId

clientA requestCommitId : 1, 2 -> 2 recoveries Master:
reject -> van tao ra 1 commit (do nothing) (-> chi danh cho thang client A)

Commit mapReduce -> CommitOptimize

```javascript
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

// stash -> trùng context với nhau ?? can access to dbName with this pattern : inject provide ... commit has dbName (can
provide at client or master)
this.getParent()
