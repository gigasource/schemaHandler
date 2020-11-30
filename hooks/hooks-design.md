* [_] supports once :
* [_] supports default hooks: 
    * [_] neu ko co hook nao cung event thi su dung default
    * [_] fallback function is good idea too
* [_] base on event emitter
* [_] 

* [_] multi layer: on/pre/post
    * [_] support async 
* [_] support persistent : 
    * [_] vd vua khoi dong lai thi tu dong gan callback
    
* [_] support return, mutate result !
        
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
