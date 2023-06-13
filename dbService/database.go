package dbService

import (
	"ProjectTrishula/dbService/dbcore"
	_ "github.com/denisenkom/go-mssqldb"
	"net/http"
)

func Main() {

	var MangaList = dbcore.SqlInit()

	r := dbcore.InitHttpServerMux(MangaList)

	http.ListenAndServe("localhost:8080", &r)

}
