package dbService

import (
	"ProjectTrishula/dbService/core"
	_ "github.com/denisenkom/go-mssqldb"
	"net/http"
)

func Main() {

	var MangaList = core.SqlInit()

	r := core.InitHttpServerMux(MangaList)

	http.ListenAndServe("localhost:8080", &r)

}
