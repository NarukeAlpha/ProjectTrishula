package mcore

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"sync"
)

func MangaSync(c chan []DbMangaEntry, wg *sync.WaitGroup) {
	r, err := http.Get("http://localhost:8080/Manga/get-list")
	if err != nil {
		panic(err)
	}

	var MangaList []DbMangaEntry
	if err = json.NewDecoder(r.Body).Decode(&MangaList); err != nil {
		panic(err)
	}
	c <- MangaList
	err = r.Body.Close()
	if err != nil {
		log.Panic(err)
	}
	return
}

func MangaUpdate(manga DbMangaEntry) {
	mangaJson, err := json.Marshal(manga)
	if err != nil {
		panic(err)
	}
	r, err2 := http.NewRequest(http.MethodPost, "http://localhost:8080/Manga/update-chapter", bytes.NewBuffer(mangaJson))
	if err2 != nil {
		panic(err2)
	}
	r.Header.Set("Content-Type", "application/json")
	clnt := http.DefaultClient
	resp, err := clnt.Do(r)
	if err != nil {
		panic(err)
	}
	err = resp.Body.Close()
	if err != nil {
		log.Println(err)
	}

}
