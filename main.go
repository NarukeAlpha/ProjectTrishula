package main

import (
	"ProjectTrishula/dbService"
	"ProjectTrishula/discordService"
	"ProjectTrishula/monitorService"
)

func main() {
	go dbService.Main()
	go discordService.Main()
	go monitorService.Main()

}
