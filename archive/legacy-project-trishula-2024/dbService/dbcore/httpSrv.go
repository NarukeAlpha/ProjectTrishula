package dbcore

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/mux"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func InitHttpServerMux(mL []DbMangaEntry, collection mongo.Collection, indexMap map[primitive.ObjectID]int) mux.Router {
	rt := mux.NewRouter()
	rt.HandleFunc("/exit", func(w http.ResponseWriter, r *http.Request) {
		os.Exit(2)
	})
	rt.HandleFunc("/Manga/get-list", func(w http.ResponseWriter, r *http.Request) {
		log.Print("GET request called by ", r.RemoteAddr)
		if err := json.NewEncoder(w).Encode(mL); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

	}).Methods("GET")

	rt.HandleFunc("/Manga/update-chapter", func(w http.ResponseWriter, r *http.Request) {
		log.Print("POST request called by ", r.RemoteAddr)
		var mangaEntry DbMangaEntry
		if err := json.NewDecoder(r.Body).Decode(&mangaEntry); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var index int = indexMap[mangaEntry.Did]
		mL[index].DlastChapter = mangaEntry.DlastChapter
		mL[index].DchapterLink = mangaEntry.DchapterLink

		addChapterToTable(collection, mangaEntry)

	}).Methods("POST")

	rt.HandleFunc("/Manga/add-manga", func(w http.ResponseWriter, r *http.Request) {
		log.Print("POST request called by ", r.RemoteAddr)
		var mangaEntry DbMangaEntry
		if err := json.NewDecoder(r.Body).Decode(&mangaEntry); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		mL = append(mL, mangaEntry)
		addNewMangaToTable(collection, mangaEntry)

	}).Methods("POST")

	return *rt
}
