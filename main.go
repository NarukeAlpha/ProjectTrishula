package main

import (
	"ProjectTrishula/resources"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
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
	Server   string `json:"server"`
	Port     string `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	Database string `json:"database"`
}
var Monitor struct {
	Webhook string `json:"webhook"`
}

func init() {
	// load json data file
	// load data into variables
	// check if data is valid
	// if data is not valid, start a setup process
	file, err := os.Open("data.dev.json")
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
		resources.AssertErrorToNil("failed to close file: %v", file.Close())

	} else {
		resources.AssertErrorToNil("failed to close file: %v", file.Close())

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
		fmt.Print("Server: ")
		fmt.Scanln(&DbKey.Server)
		fmt.Print("Port: ")
		fmt.Scanln(&DbKey.Port)
		fmt.Print("User: ")
		fmt.Scanln(&DbKey.User)
		fmt.Print("Password: ")
		fmt.Scanln(&DbKey.Password)
		fmt.Print("Database: ")
		fmt.Scanln(&DbKey.Database)

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
		resources.AssertErrorToNil("Error closing data.json: %v", file.Close())

	}

}

func main() {

	//go dbService.Main()
	//go discordService.Main()
	//go monitorService.Main()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	log.Println("Press Ctrl+C to exit")
	<-stop

}
