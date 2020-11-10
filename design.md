### design

* [x] registerSchema(collectionName, dbName, schema, options)
* [x] getCollection(db, name, config)
    * [x] supports TTL (Cache) setTTL
    * [x] supports test pattern for dbName
* [x] Populate
    * [x] populate doc
    * [x] populate array
    * [x] auto populate
* [_] hooks
    * [x] create/insert (pre, post) (many)
    * [x] update (pre, post) (many)
    * [x] mutate (pre, post) (many)
        * [x] c/r/u/d
        * [x] isMany
        * [_] isPre/isPost
        * [_] condition
    * [x] delete (pre, post)
    * [x] find (pre, post)
* [_] debug : get mongo query     
* [x] convert collectionName : Person -> person
* [x] multidb  
* [_] multiconnection 
* [x] findOneAndUpdate parse $set -> ... 
* [x] findById
* [x] [String]
* [x] insertMany -> parseSchema
* [x] updateMany -> parseCondition
* [_] parseSchema for returnResult (consider because of performance and fake data)
    * [_] find/findOne 
    
* [_] index
* [x] support migrate data
* [x] sync system
* [x] await for connected

// Cache
orm._getCollection(collection, dbName) -> Collection
orm.getCollection(collection, dbName) -> Proxy
orm.getModel(alias)

orm.cache 

models['collection@db']


