package Core

import "log"

func AssertErrorToNil(message string, err error) {
	if err != nil {
		log.Panicf(message, err)
	}
}

//type SetUpC struct {
//	Completed bool `json:"completed"`
//}
//type DiscordS struct {
//	GuildID  string `json:"guildID"`
//	BotToken string `json:"botToken"`
//	RemCmd   bool   `json:"remCmd"`
//}
//type DbKey struct {
//	Url        string `json:"url"`
//	User       string `json:"user"`
//	Password   string `json:"password"`
//	Database   string `json:"database"`
//	Collection string `json:"collection"`
//}
//type MonitorW struct {
//	Webhook string `json:"webhook"`
//}

//type SetUp struct {
//	SetUpC SetUpC `json:"setUpC"`
//}
//type Discord struct {
//	DiscordS DiscordS `json:"discordS"`
//}
//type Db struct {
//	DbKey DbKey `json:"dbKey"`
//}
//type Monitor struct {
//	MonitorW MonitorW `json:"monitorW"`
//}
