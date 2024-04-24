package dbcore

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/mux"
	"go.mongodb.org/mongo-driver/mongo"
)

func InitHttpServerMux(mL []DbMangaEntry, collection mongo.Collection) mux.Router {
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
			var index int = getSliceIndex(mL, mangaEntry.Did)
			mL[index].DlastChapter = mangaEntry.DlastChapter
			mL[index].DchapterLink = mangaEntry.DchapterLink

			addChapterToTable(collection, mangaEntry)

		case "POST":
			log.Print("POST request called by ", request.RemoteAddr)
			var mangaEntry DbMangaEntry
			if err := json.NewDecoder(request.Body).Decode(&mangaEntry); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			mL = append(mL, mangaEntry)
			addNewMangaToTable(collection, mangaEntry)

		}
	}).Methods("GET", "PUT", "POST")

	return *rt
}
