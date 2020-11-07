### design

* [x] registerSchema(collectionName, dbName, schema, options)
* [x] getCollection(db, name, config)
    * [x] supports TTL (Cache)
    * [x] supports regex for dbName
* [x] Populate
    * [x] populate doc
    * [x] populate array
    * [x] auto populate
* [_] hooks
    * [_] create/insert (pre, post) (many)
    * [_] update (pre, post) (many)
    * [_] mutate (pre, post) (many)
    * [_] delete (pre, post)
* [_] debug : get mongo query     
* [_] convert collectionName : Person -> person
* [x] multidb  
* [_] multiconnection 
* [x] findOneAndUpdate parse $set -> ... 
* [x] findById
* [x] [String]
* [_] insertMany -> parseSchema
* [_] updateMany -> parseCondition

* [x] index


// Cache
orm._getCollection(collection, dbName) -> Collection
orm.getCollection(collection, dbName) -> Proxy
orm.getModel(alias)

orm.cache 

models['collection@db']


