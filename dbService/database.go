package dbService

import (
	"log"
	"net/http"
	"sync"

	"ProjectTrishula/dbService/dbcore"
	_ "github.com/denisenkom/go-mssqldb"
)

func Main(dbkey struct {
	Url        string `json:"url"`
	User       string `json:"user"`
	Password   string `json:"password"`
	Database   string `json:"database"`
	Collection string `json:"collection"`
}, wg *sync.WaitGroup) {
	var key = "mongodb+srv://" + dbkey.User + ":" + dbkey.Password + "@" + dbkey.Url

	var MangaList, MongoDBCollection = dbcore.SqlInit(key, dbkey.Database, dbkey.Collection)

	r := dbcore.InitHttpServerMux(MangaList, MongoDBCollection)
	wg.Done()
	err := http.ListenAndServe("localhost:8080", &r)
	if err != nil {
		log.Panicf("Error starting server: %v", err)
	}

}
