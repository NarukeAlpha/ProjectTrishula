package dbService

import (
	"ProjectTrishula/dbService/dbcore"
	_ "github.com/denisenkom/go-mssqldb"
	"net/http"
	"sync"
)

func Main(dbkey struct {
	Server   string `json:"server"`
	Port     string `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	Database string `json:"database"`
}, wg *sync.WaitGroup) {
	var key = "server=" + dbkey.Server + ";port=" + dbkey.Port + ";user id=" + dbkey.User + ";password=" + dbkey.Password + ";database=" + dbkey.Database

	var MangaList = dbcore.SqlInit(key)

	r := dbcore.InitHttpServerMux(MangaList, key)
	wg.Done()
	http.ListenAndServe("localhost:8080", &r)

}
