package dbcore

import (
	"context"
	"log"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type DbMangaEntry struct {
	Did          primitive.ObjectID `json:"_id"`
	Dmanga       string             `json:"manga"`
	DlastChapter int                `json:"lastchapter"`
	Dmonitoring  bool               `json:"monitoring"`
	DchapterLink string             `json:"chapterlink"`
	Didentifier  string             `json:"identifier"`
}

func SqlInit(key string, database string, collctn string) ([]DbMangaEntry, mongo.Collection) {

	serverAPI := options.ServerAPI(options.ServerAPIVersion1)
	clientOptions := options.Client().ApplyURI(key).SetServerAPIOptions(serverAPI)

	client, err := mongo.Connect(context.TODO(), clientOptions)
	if err != nil {
		log.Fatalf("Error connecting to MongoDB: %v", err)
	}
	collection := client.Database(database).Collection(collctn)
	var mangaEntry = readingMangaTable(*collection)

	return mangaEntry, *collection
}

func readingMangaTable(db mongo.Collection) []DbMangaEntry {

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

	for cursor.Next(context.Background()) {
		var entry DbMangaEntry
		err := cursor.Decode(&entry)
		if err != nil {
			log.Printf("Couldn't decode document: %v", err)
		}
		mangaL = append(mangaL, entry)
	}
	if err := cursor.Err(); err != nil {
		log.Fatal("Error iterating cursor: ", err.Error())
	}
	return mangaL

}

func updateOffMangaListTable(collection mongo.Collection, entry DbMangaEntry) {
	filter := bson.M{"did": entry.Did}
	update := bson.M{"$set": bson.M{"dlastChapter": entry.DlastChapter, "dmonitoring": false}}
	_, err := collection.UpdateOne(context.Background(), filter, update)
	if err != nil {
		log.Fatalf("Failed to update manga list row: %v", err)
	}
}

func addChapterToTable(collection mongo.Collection, entry DbMangaEntry) {
	filter := bson.M{"_id": entry.Did}
	update := bson.M{"$set": bson.M{"dlastChapter": entry.DlastChapter, "dchapterLink": entry.DchapterLink}}
	_, err := collection.UpdateOne(context.Background(), filter, update)
	if err != nil {
		log.Fatalf("Failed to update latest chapter in Manga Table: %v", err)
	}
	log.Printf("Updated latest chapter in Manga Table for %s %d", entry.Dmanga, entry.DlastChapter)
}

func addNewMangaToTable(collection mongo.Collection, entry DbMangaEntry) {
	_, err := collection.InsertOne(context.Background(), entry)
	if err != nil {
		log.Fatalf("Failed to insert new manga in DB: %v", err)
	}
	log.Printf("Added new manga to DB: %s", entry.Dmanga)
}

func getSliceIndex(s []DbMangaEntry, id primitive.ObjectID) int {
	for i, v := range s {
		if v.Did == id {
			return i
		}
	}
	return -1
}

//func updateOffMangaListTable(db sql.DB, entry DbMangaEntry) {
//
//	var boolean int = 0
//	/*
//		turning off monitoring when manga is completed
//	*/
//	var query = fmt.Sprintf("UPDATE MasterTable SET LastChapter = %d, Monitoring = %v WHERE ID = %d", entry.DlastChapter, boolean, entry.Did)
//	_, err := db.ExecContext(context.Background(), query)
//	if err != nil {
//		log.Fatalf("failed to update manga list row:", err.Error())
//
//	}
//}
//func addChapterToTable(db sql.DB, entry DbMangaEntry) {
//	var query = fmt.Sprintf("UPDATE MasterTable SET LastChapter = %v, ChapterLink ='%v' WHERE ID = %v", entry.DlastChapter, entry.DchapterLink, entry.Did)
//	_, err := db.ExecContext(context.Background(), query)
//	if err != nil {
//		log.Fatalf("failed to update latest chapter in Manga Table:", err.Error())
//
//	}
//	log.Printf("Updated latest chapter in Manga Table for %s %d", entry.Dmanga, entry.DlastChapter)
//
//}
//
//func addNewMangaToTable(db sql.DB, entry DbMangaEntry) {
//	var boolean int = 1
//	qGetLastId := fmt.Sprintf("SELECT TOP 1 ID FROM MasterTable ORDER BY ID DESC")
//	lastId, err := db.QueryContext(context.Background(), qGetLastId)
//	if err != nil {
//		log.Fatalf("failed to get last ID from Manga Table:", err.Error())
//	}
//
//	var lastIdInt int
//	for lastId.Next() {
//		err := lastId.Scan(&lastIdInt)
//		if err != nil {
//			log.Fatalf("failed to scan last ID from Manga Table:", err.Error())
//		}
//	}
//	lastId.Close()
//	var newID = lastIdInt + 1
//
//	var query = fmt.Sprintf("INSERT INTO MasterTable (ID, Manga, LastChapter, Monitoring, ChapterLink, Identifier) VALUES (%d,'%s', %d, %d, '%s', '%s')", newID, entry.Dmanga, entry.DlastChapter, boolean, entry.DchapterLink, entry.Didentifier)
//	_, err = db.ExecContext(context.Background(), query)
//	if err != nil {
//		log.Fatalf("failed to insert new manga in DB:", err.Error())
//
//	}
//	log.Printf("Added new manga to DB: %s", entry.Dmanga)
//}
