### design

* [x] getCollection(db, name, config)
    * [x] supports TTL (Cache)
* [_] Auto populate

* [x] hooks
* [_] convert collectionName : Person -> person
* [x] multidb  
* [_] multiconnection 
* [x] findOneAndUpdate parse $set -> ... 
* [x] findById
* [x] [String]

* [x] index


// Cache
orm._getCollection(collection, dbName) -> Collection
orm.getCollection(collection, dbName) -> Proxy
orm.getModel(alias)

orm.cache 

models['collection@db']


