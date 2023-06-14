package dbcore

import (
	"encoding/json"
	"github.com/gorilla/mux"
	"log"
	"net/http"
	"os"
)

func InitHttpServerMux(mL []DbMangaEntry, key string) mux.Router {
	rt := mux.NewRouter()
	rt.HandleFunc("/exit", func(w http.ResponseWriter, r *http.Request) {
		os.Exit(2)
	})
	rt.HandleFunc("/MangaList", func(w http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case "GET":
			log.Print("GET request called by ", request.RemoteAddr)
			if err := json.NewEncoder(w).Encode(mL); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

		case "PUT":
			log.Print("PUT request called by ", request.RemoteAddr)
			var mangaEntry DbMangaEntry
			if err := json.NewDecoder(request.Body).Decode(&mangaEntry); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			//mL = append(mL, mangaEntry)
			mL[(mangaEntry.Did - 1)].DlastChapter = mangaEntry.DlastChapter
			mL[(mangaEntry.Did - 1)].DchapterLink = mangaEntry.DchapterLink
			var db = dbConnection(key)
			defer db.Close()
			addChapterToTable(db, mangaEntry)

		case "POST":
			log.Print("POST request called by ", request.RemoteAddr)
			var mangaEntry DbMangaEntry
			if err := json.NewDecoder(request.Body).Decode(&mangaEntry); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			mL = append(mL, mangaEntry)
			var db = dbConnection(key)
			defer db.Close()
			addNewMangaToTable(db, mangaEntry)

		}
	}).Methods("GET", "PUT", "POST")

	return *rt
}
