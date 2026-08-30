package mcore

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
)

type Embed struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Color       int     `json:"color"`
	Fields      []Field `json:"fields"`
}

type Field struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

func WebhookSend(manga DbMangaEntry) {
	mangaJson, err := json.Marshal(manga)
	if err != nil {
		panic(err)
	}
	req2, err := http.NewRequest("POST", "http://localhost:8081/discord/channel-message", bytes.NewBuffer(mangaJson))
	if err != nil {
		log.Fatal("Couldn't create webhook")
	}
	req2.Header.Set("Content-Type", "application/json")
	client2 := &http.Client{}
	resp2, err := client2.Do(req2)
	if err != nil {
		log.Printf("Couldn't send request")
	}
	defer resp2.Body.Close()
}
