package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"sync"

	"ProjectTrishula/Core"
	"ProjectTrishula/dbService"
	"ProjectTrishula/discordService"
	"ProjectTrishula/monitorService"
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

var mw io.Writer

var datajsonenv = "data.dev.json"

func init() {

	_, err := os.Stat(datajsonenv)
	if os.IsNotExist(err) {
		_, err = os.Create(datajsonenv)
		if err != nil {
			log.Fatal(err)
		}
	}
	_, err = os.Stat("ProxyList.csv")
	if os.IsNotExist(err) {
		log.Fatalln("PoxyList.csv not found, please provide a csv file named ProxyList in the same directory as the exe")

	}
	file, err := os.Open(datajsonenv)
	if err != nil {
		log.Panicf("Error opening data.json: %v", err)

	}
	decoder := json.NewDecoder(file)
	err = decoder.Decode(&data)
	if err != nil {
		log.Panicf("Error decoding data.json: %v", err)
	}
	log.Printf("Setup completed: %v", data.DbKey.User)
	if !data.SetUp.Completed {

		fmt.Print("Enter Discord GuildID: ")
		fmt.Scanln(&data.Discord.GuildID)
		fmt.Print("Enter Discord BotToken: ")
		fmt.Scanln(&data.Discord.BotToken)
		fmt.Print("Enter Discord RemCmd: ")
		fmt.Scanln(&data.Discord.RemCmd)

		fmt.Print("Enter DbKey Url: ")
		fmt.Scanln(&data.DbKey.Url)
		fmt.Print("Enter DbKey User: ")
		fmt.Scanln(&data.DbKey.User)
		fmt.Print("Enter DbKey Password: ")
		fmt.Scanln(&data.DbKey.Password)
		fmt.Print("Enter DbKey Database: ")
		fmt.Scanln(&data.DbKey.Database)
		fmt.Print("Enter DbKey Collection: ")
		fmt.Scanln(&data.DbKey.Collection)

		fmt.Print("Enter Monitor Webhook: ")
		fmt.Scanln(&data.Monitor.Webhook)
		data.SetUp.Completed = true

		file, err = os.OpenFile(datajsonenv, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0755)
		if err != nil {
			log.Panicf("Error opening data.json: %v", err)
		}

		encoder := json.NewEncoder(file)
		if err = encoder.Encode(data); err != nil {
			log.Panicf("Error encoding data.json: %v", err)
		}

	}
	Core.AssertErrorToNil("failed to close file: %v", file.Close())
	_, err = os.Stat("log.txt")
	if os.IsNotExist(err) {
		file, err = os.Create("log.txt")
		if err != nil {
			log.Fatal(err)
		}
	}
	file, err = os.OpenFile("log.txt", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		log.Fatal(err)
	}

	mw = io.MultiWriter(os.Stdout, file)
	log.SetOutput(mw)
	log.Println("This is a log message")

}

func main() {
	var wg sync.WaitGroup
	wg.Add(2)
	go dbService.Main(data.DbKey, &wg)
	var discordservicevar struct {
		GuildID  string `json:"guildID"`
		BotToken string `json:"botToken"`
		RemCmd   bool   `json:"remCmd"`
	}
	discordservicevar.GuildID = data.Discord.GuildID
	discordservicevar.BotToken = data.Discord.BotToken
	discordservicevar.RemCmd = data.Discord.RemCmd

	go discordService.Main(discordservicevar, &wg)
	wg.Wait()

	log.Println("starting monitor service")
	go monitorService.Main(data.Monitor.Webhook)
	log.Println("All services started")

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	log.Println("Press Ctrl+C to exit")
	<-stop

}
