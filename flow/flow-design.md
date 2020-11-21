* [x] reduce hooks
* [_] emit, on
    * [_] on -> stack lai scope hien tai
    * [_] flow.on().doA().on().doB() 
* [_] make shorthand concept
    * flow.shorthand(':doA').doB().doC()    
* [_] order({}) -> scope(args).toBE()
* [_] transport
    * [_] make example 
    * [_] concept hub : -> neu nhu emit den hub
* [_] plugin concept 
* [_] this concept 
* [_] iterator concept 
* [_] init git module
* [_] flow.require(orm, {blacklist, whitelist, callBeforeUse,chainable})
    * [_] blacklist
    * [_] whitelist
    * [x] try with orm
    * [_] chainable
    
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
     

* [_] define reactive layer with flow
    * [_] computed: order.vSum = ''; apply to all hooks: dong bo giua backend, frontend
    * [_] onEffect() -> better to use because of easier
    
* [_] expect:
    * [_] https://www.chaijs.com/

* [_] warning if has more than 1 hook

``` javascript
hooks.post(':scope', async function ({fn, args, index, chain, scope}, returnResult) {
  _.merge(scope, args[0]);
})
```

``` javascript
await flow.scope({table: 1}).orm('Order').create('@scope').end().log();
```
