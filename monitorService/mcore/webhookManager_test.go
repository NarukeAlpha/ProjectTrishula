package mcore

import (
	"encoding/json"
	"log"
	"os"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type SetUp struct {
	Completed bool `json:"completed"`
}

type Discord struct {
	GuildID  string `json:"guildID"`
	BotToken string `json:"botToken"`
	RemCmd   bool   `json:"remcmd"`
}

type DbKey struct {
	Url        string `json:"url"`
	User       string `json:"user"`
	Password   string `json:"password"`
	Database   string `json:"database"`
	Collection string `json:"collection"`
}

type Monitor struct {
	Webhook string `json:"webhook"`
}

type Data struct {
	SetUp   SetUp   `json:"setUp"`
	Discord Discord `json:"discord"`
	DbKey   DbKey   `json:"dbKey"`
	Monitor Monitor `json:"monitor"`
}

var data Data
var datajsonenv = "data.dev.json"

var oid primitive.ObjectID = primitive.NewObjectID()

func TestWebhookSend(t *testing.T) {
	var manga = DbMangaEntry{
		Did:          oid,
		Dmanga:       "Test",
		DlastChapter: 1,
		Dmonitoring:  true,
		DchapterLink: "https://www.google.com",
		Didentifier:  "test",
	}
	_, err := os.Stat(datajsonenv)
	if os.IsNotExist(err) {
		_, err = os.Create(datajsonenv)
		if err != nil {
			log.Fatal(err)
		}
	}

	file, err := os.Open(datajsonenv)
	if err != nil {
		log.Panicf("Error opening data.json: %v", err)

	}
	decoder := json.NewDecoder(file)
	err = decoder.Decode(&data)

	t.Run(t.Name(), func(t *testing.T) {
		WebhookSend(manga, data.Monitor.Webhook)
	})

	//type args struct {
	//	manga DbMangaEntry
	//}
	//tests := []struct {
	//	name string
	//	args args
	//}{
	//	// TODO: Add test cases.
	//}
	//for _, tt := range tests {
	//	t.Run(tt.name, func(t *testing.T) {
	//		WebhookSend(tt.args.manga)
	//	})
	//}
}
