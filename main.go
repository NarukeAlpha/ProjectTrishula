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

var SetUp struct {
	Completed bool `json:"completed"`
}
var DiscordS struct {
	GuildID  string `json:"guildID"`
	BotToken string `json:"botToken"`
	RemCmd   bool   `json:"remCmd"`
}
var DbKey struct {
	Url        string `json:"url"`
	User       string `json:"user"`
	Password   string `json:"password"`
	Database   string `json:"database"`
	Collection string `json:"collection"`
}
var Monitor struct {
	Webhook string `json:"webhook"`
}
var mw io.Writer

func init() {

	// load json data file
	// load data into variables
	// check if data is valid
	// if data is not valid, start a setup process
	_, err := os.Stat("data.json")
	if os.IsNotExist(err) {
		_, err = os.Create("data.json")
		if err != nil {
			log.Fatal(err)
		}
	}
	_, err = os.Stat("ProxyList.csv")
	if os.IsNotExist(err) {
		log.Fatalln("PoxyList.csv not found, please provide a csv file named ProxyList in the same directory as the exe")

	}
	file, err := os.Open("data.json")
	if err != nil {
		log.Panicf("Error opening data.json: %v", err)

	}
	decoder := json.NewDecoder(file)
	if err = decoder.Decode(&SetUp); err != nil {
		log.Panicf("Error decoding data.json: %v", err)
	}

	if SetUp.Completed {

		err = decoder.Decode(&DiscordS)
		if err != nil {
			log.Panicf("Error decoding data.json: %v", err)

		}
		err = decoder.Decode(&DbKey)
		if err != nil {
			log.Panicf("Error decoding data.json: %v", err)

		}
		err = decoder.Decode(&Monitor)
		if err != nil {
			log.Panicf("Error decoding data.json: %v", err)

		}
		Core.AssertErrorToNil("failed to close file: %v", file.Close())

	} else {
		Core.AssertErrorToNil("failed to close file: %v", file.Close())

		// Ask for Discord configuration values
		fmt.Println("Enter Discord configuration:")
		fmt.Print("Guild ID: ")
		fmt.Scanln(&DiscordS.GuildID)
		fmt.Print("Bot Token: ")
		fmt.Scanln(&DiscordS.BotToken)
		fmt.Print("Remove Commands (true/false): ")
		fmt.Scanln(&DiscordS.RemCmd)

		// Ask for Database configuration values
		fmt.Println("\nEnter Database configuration:")
		fmt.Print("Url: ")
		fmt.Scanln(&DbKey.Url)
		fmt.Print("User: ")
		fmt.Scanln(&DbKey.User)
		fmt.Print("Password: ")
		fmt.Scanln(&DbKey.Password)
		fmt.Print("Database: ")
		fmt.Scanln(&DbKey.Database)
		fmt.Print("Collection: ")
		fmt.Scanln(&DbKey.Collection)

		// Ask for Monitor configuration value
		fmt.Println("\nEnter Monitor configuration:")
		fmt.Print("Webhook: ")
		fmt.Scanln(&Monitor.Webhook)

		SetUp.Completed = true
		file, err = os.OpenFile("data.dev.json", os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0755)
		if err != nil {
			log.Panicf("Error opening data.json: %v", err)
		}

		encoder := json.NewEncoder(file)
		if err = encoder.Encode(SetUp); err != nil {
			log.Panicf("Error encoding data.json: %v", err)
		}
		if err = encoder.Encode(DiscordS); err != nil {
			log.Panicf("Error encoding data.json: %v", err)
		}
		if err = encoder.Encode(DbKey); err != nil {
			log.Panicf("Error encoding data.json: %v", err)

		}
		if err = encoder.Encode(Monitor); err != nil {
			log.Panicf("Error encoding data.json: %v", err)
		}
		Core.AssertErrorToNil("Error closing data.json: %v", file.Close())

	}
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
	go dbService.Main(DbKey, &wg)
	go discordService.Main(DiscordS, &wg)
	wg.Wait()

	log.Println("starting monitor service")
	go monitorService.Main(Monitor.Webhook)
	log.Println("All services started")

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	log.Println("Press Ctrl+C to exit")
	<-stop

}
