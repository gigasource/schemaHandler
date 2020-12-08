* [_] supports once :
* [_] supports default hooks: 
    * [_] neu ko co hook nao cung event thi su dung default
    * [_] fallback function is good idea too
* [_] base on event emitter
* [_] 

* [x] multi layer: on/pre/post
    * [x] support async
* [_] multi layer like z-index:
    * hooks.on('test', layer = 0, listener)
    
* [_] support persistent : 
    * [_] vd vua khoi dong lai thi tu dong gan callback
    
* [_] support return, mutate result !

* [_] support multi events ['event1', 'event2']

* [_] support auto completion for emit/on
* [_] support transparent same flow uuid for cross platform



vd : 
callback() {
    console.log(a1) 
    //should be stringify and save in db 
    -> reassign by lifecycle ??
}

recompile callback -> 
vd nhu tao ra 1 layer phia ngoai de provide scope
{scope : {}, } || or scopeFactory concept: ->
two layer callback : one for use scope in parent, 
one for store in db 
