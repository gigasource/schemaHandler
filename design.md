### design

* [x] registerSchema(collectionName, dbName, schema, options)
* [x] getCollection(db, name, config)
    * [x] supports TTL (Cache) setTTL
    * [x] supports test pattern for dbName
* [x] Populate
    * [x] populate doc
    * [x] populate array
    * [x] auto populate
    * [_] obj.author = {_id} -> parse to object id before update
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
    * [_] _id: unique

* [x] support migrate data
* [x] sync system
* [x] await for connected

* [x] connection/client options

* [x] collection options : use for get collection
    * [x] supports read/write concern
    * http://mongodb.github.io/node-mongodb-native/3.6/api/Db.html#collection


* [x] supports case .find().count(); -> chain query
* [_] supports $and for case .find({a: 1}).find({a: 2})
* [x] supports array filter
* [_] default db name 
* [_] orm run on frontend
    * [_] frontend: -> without mongodb driver :
    * split code, truyen mongodb driver tu ngoai vao 
    * make one test

* [_] incremental id : -> get highest
* [_] index, majority cac kieu
* [_] cache for high speed, case frontend ??

// Cache
orm._getCollection(collection, dbName) -> Collection
orm.getCollection(collection, dbName) -> Proxy
orm.getModel(alias)

orm.cache 

models['collection@db']

[x] object in object don't need gen
[x] object id should not gen auto
