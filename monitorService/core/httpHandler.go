package Core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"sync"
)

func MangaSync(c chan []DbMangaEntry, wg *sync.WaitGroup) {
	defer wg.Done()
	r, err := http.Get("http://localhost:8080/MangaList")
	if err != nil {
		panic(err)
	}
	defer r.Body.Close()
	var MangaList []DbMangaEntry
	if err = json.NewDecoder(r.Body).Decode(&MangaList); err != nil {
		panic(err)
	}
	c <- MangaList
	return
}

func MangaUpdate(manga DbMangaEntry) {
	mangaJson, err := json.Marshal(manga)
	if err != nil {
		panic(err)
	}
	r, err2 := http.NewRequest(http.MethodPut, "http://localhost:8080/MangaList", bytes.NewBuffer(mangaJson))
	if err2 != nil {
		panic(err2)
	}
	r.Header.Set("Content-Type", "application/json")
	clnt := http.DefaultClient
	resp, err := clnt.Do(r)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

}
