### design

* [x] registerSchema(collectionName, dbName, schema, options)
* [x] getCollection(db, name, config)
    * [x] supports TTL (Cache)
    * [x] supports regex for dbName
* [_] Populate
    * [_] populate doc
    * [_] populate array
    * auto populate
* [x] hooks
* [_] convert collectionName : Person -> person
* [x] multidb  
* [_] multiconnection 
* [x] findOneAndUpdate parse $set -> ... 
* [x] findById
* [x] [String]
* insertMany, updateMany -> parseSchema

* [x] index


// Cache
orm._getCollection(collection, dbName) -> Collection
orm.getCollection(collection, dbName) -> Proxy
orm.getModel(alias)

orm.cache 

models['collection@db']


