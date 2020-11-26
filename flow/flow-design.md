* [x] reduce hooks

* [_] emit, on
    * [_] on -> stack lai scope hien tai
    * [_] flow.on().doA().on().doB()
    * [_] return: -> breakCallback: flow.on().doA().doB().return().doC()
    
* [_] make shorthand concept
    * flow.shorthand(':doA').doB().doC()    
* [_] order({}) -> scope(args).toBE()


* [_] transport
    * [_] make example 
    * [_] concept hub : -> neu nhu emit den hub
    * [_] register socket node 
    * syntax: 'server', 'begin', 'back', 'cloud'
    * syntax: to (':clientId') , ('::cloud')
    
   
* [_] plugin concept 
* [_] this concept 
* [_] iterator concept 
* [_] init git module
* [_] flow.require(orm, {blacklist, whitelist, callBeforeUse,chainable})
    * [_] blacklist
    * [_] whitelist
    * [x] try with orm
    * [_] chainable
    * [_] @next : socket.onAddP2pStream({}, '@next').;
    
* [_] concept global flow
* [_] consider: Flow or flow

* [_] scope strategy
    * [_] stash scope
    * [_] support path
        * flow.scope({test : {a: 10}}).path('@.test')
    * '@' -> scope, '@scope' -> scope, '@.a' -> scope.a
    * '@other' : scopes['other']
    * 'stash[@last]' -> last scope 
    * lastScope() -> use last scope
    * [_] query layer for scope : query.convertArgs(args) -> _args
    * [_] getScope: scope();
    
* [_] end: end('@stream') : save to stores[stream] the variable
* [_] cursor concept
    * $ is delegate for end/new flow : flow.doA().doB().$.doC().doD()
    * có mấy vấn đề : 1 là chain mà ko dùng tiếp flow , dùng 1 module cụ thể,
        * [_] type 1 : chain 
        * [_] type 2 : return result -> use result for next command (problem: break if it is end result)
        * [_] how to declare in api : chainable ? true : false
    * [_] current cursor : like current module (begin -> end)
    * [_] end -> end one cursor
    * [_] @callback : use callback for next chain: flow.onAddP2pStream('channel', '@callback[indexOfObject]').pipe()
    * [_] flow.createFileStream().pipe('@next')
            f('socket').socket().end()
            
* [_] define reactive layer with flow
    * [_] computed: order.vSum = ''; apply to all hooks: dong bo giua backend, frontend
    * [_] onEffect() -> better to use because of easier
    
* [_] expect:
    * [_] https://www.chaijs.com/

* [_] warning if has more than 1 hook
* [_] combine : socket.io/transport layer, orm , reactive , flow
    * [_] use case1 : 

* [_] universal remote environment : 
    * [_] use for deploy new env for flow (over ssh maybe)
    * [_] debug mode on android ssh ?? 
     
* [_] reactive layer:
    * [_] flow.reactive({})
    * [_] flow.on('watch:@.price').toBE().orm('Order').updateOne({_id: '@._id'}, '@').end().end();
    * [_] flow
    
* [_] use flow for frontend how ??
    * [_] flow.on('click').showDialog('Confirm').once('confirm').toBE().doA();
    * [_] control all data layer:
         
* [_] orm & flow:
    * [_] make plugin
    * [_] updateOne: firstCondition should be 
             
Example :

* [_] binding reactive between 2 process ??
    * [_] use case : auto save, edit, something change on another process
    * [_] process 1 : update doc -> write to db commit -> fake (wait approve signal) -> if received refresh frontend;

* commit concept: fake -> after approve : update -> if decline -> remove , supports build from commit
    
* [_] move table:
    * [_] concept assign data -> collection : like mongoose model  
    * [_] flow.scope({order, toTable}).orm('Order').updateOne({_id: '@.order._id'},{$set : {table: '@.toTable'}}).commit('update').end();
    
* [_] save Product: 

Test:
* [_] thread worker

    
### simulate a new app :
* test: env 
* vuminal -> test with cli 


* [_] tao ra layout : 
    * mix with edit screen ?? 
    * compile to vue file on disk (maybe is very good)
    * multi layer concept for customize
    * decorator layer -> depend on state -> basic layer 1 + customize layer 1 + customize layer 2

* [_] await problem :neu truyen qua nhieu moi truong : await ko dam bao la cau lenh da chay thanh cong !!!

``` javascript
hooks.post(':scope', async function ({fn, args, index, chain, scope, query}, returnResult) {
  _.merge(scope, args[0]);
})
```

``` javascript
await flow.scope({table: 1}).orm('Order').create('@scope').end().log();
```
