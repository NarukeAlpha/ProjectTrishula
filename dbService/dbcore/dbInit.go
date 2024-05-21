package dbcore

import (
	"context"
	"log"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type DbMangaEntryBson struct {
	Did          primitive.ObjectID `bson:"_id"`
	Dmanga       string             `bson:"manga"`
	DlastChapter int                `bson:"lastchapter"`
	Dmonitoring  bool               `bson:"monitoring"`
	DchapterLink string             `bson:"chapterlink"`
	Didentifier  string             `bson:"identifier"`
}

type DbMangaEntry struct {
	Did          primitive.ObjectID `json:"_id"`
	Dmanga       string             `json:"manga"`
	DlastChapter int                `json:"lastChapter"`
	Dmonitoring  bool               `json:"monitoring"`
	DchapterLink string             `json:"chapterLink"`
	Didentifier  string             `json:"identifier"`
}

func SqlInit(key string, database string, collctn string) ([]DbMangaEntry, mongo.Collection, map[primitive.ObjectID]int) {

	serverAPI := options.ServerAPI(options.ServerAPIVersion1)
	log.Println("set ServerAPIOptions")
	clientOptions := options.Client().ApplyURI(key).SetServerAPIOptions(serverAPI)
	log.Println("set ClientOptions with key: ", key)

	client, err := mongo.Connect(context.TODO(), clientOptions)
	if err != nil {
		log.Fatalf("Error connecting to MongoDB: %v", err)
	}
	log.Println("Connected to MongoDB")
	collection := client.Database(database).Collection(collctn)
	log.Println("Pulled collection from MongoDB")
	var mangaEntry, indexMap = readingMangaTable(*collection)
	log.Println("sqlInit complete")
	return mangaEntry, *collection, indexMap
}

func readingMangaTable(db mongo.Collection) ([]DbMangaEntry, map[primitive.ObjectID]int) {

	var mangaL []DbMangaEntry
	cursor, err := db.Find(context.Background(), bson.M{})
	if err != nil {
		log.Fatal("Error querying database: ", err.Error())
	}
	defer func(cursor *mongo.Cursor, ctx context.Context) {
		err := cursor.Close(ctx)
		if err != nil {
			log.Panicf("failed to close cursor: %v", err)
		}
	}(cursor, context.Background())

	indexMap := make(map[primitive.ObjectID]int)
	for cursor.Next(context.Background()) {
		var entryBson DbMangaEntryBson
		err := cursor.Decode(&entryBson)
		if err != nil {
			log.Printf("Couldn't decode document: %v", err)
		}
		var entryJson DbMangaEntry = DbMangaEntry{entryBson.Did, entryBson.Dmanga, entryBson.DlastChapter, entryBson.Dmonitoring,
			entryBson.DchapterLink, entryBson.Didentifier}

		mangaL = append(mangaL, entryJson)
		indexMap[entryJson.Did] = len(mangaL) - 1
	}
	if err := cursor.Err(); err != nil {
		log.Fatal("Error iterating cursor: ", err.Error())
	}

	return mangaL, indexMap

}

//func updateOffMangaListTable(collection mongo.Collection, entryJson DbMangaEntry) {

/*
	this funciton needs implementing, its to turn off monitoring for a manga in the db
*/

//filter := bson.M{"did": entry.Did}
//update := bson.M{"$set": bson.M{"dlastChapter": entry.DlastChapter, "dmonitoring": false}}
//_, err := collection.UpdateOne(context.Background(), filter, update)
//if err != nil {
//	log.Fatalf("Failed to update manga list row: %v", err)
//}
//}

func addChapterToTable(collection mongo.Collection, entryJson DbMangaEntry) {

	var entryBson DbMangaEntryBson = DbMangaEntryBson{entryJson.Did, entryJson.Dmanga, entryJson.DlastChapter,
		entryJson.Dmonitoring, entryJson.DchapterLink, entryJson.Didentifier}

	filter := bson.M{"_id": entryBson.Did}
	update := bson.M{"$set": bson.M{"lastChapter": entryBson.DlastChapter, "chapterLink": entryBson.DchapterLink}}
	_, err := collection.UpdateOne(context.Background(), filter, update)
	if err != nil {
		log.Fatalf("Failed to update latest chapter in Manga Table: %v", err)
	}
	log.Printf("Updated latest chapter in Manga Table for %s %d", entryBson.Dmanga, entryBson.DlastChapter)
}

func addNewMangaToTable(collection mongo.Collection, entryJson DbMangaEntry) {
	var entryBson DbMangaEntryBson = DbMangaEntryBson{entryJson.Did, entryJson.Dmanga, entryJson.DlastChapter,
		entryJson.Dmonitoring, entryJson.DchapterLink, entryJson.Didentifier}

	_, err := collection.InsertOne(context.Background(), entryBson)
	if err != nil {
		log.Fatalf("Failed to insert new manga in DB: %v", err)
	}
	log.Printf("Added new manga to DB: %s", entryJson.Dmanga)
}

//func getSliceIndex(s []DbMangaEntry, id primitive.ObjectID) int {
//	for i, v := range s {
//		if v.Did == id {
//			return i
//		}
//	}
//	return -1
//}
