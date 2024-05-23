package discordService

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"

	"github.com/bwmarrin/discordgo"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type MangaEntry struct {
	Did          primitive.ObjectID `json:"_id"`
	Dmanga       string             `json:"manga"`
	DlastChapter int                `json:"lastChapter"`
	Dmonitoring  bool               `json:"monitoring"`
	DchapterLink string             `json:"chapterLink"`
	Didentifier  string             `json:"identifier"`
}

type discordConnection struct {
	GuildID   string `json:"guildID"`
	BotToken  string `json:"botToken"`
	RemCmd    bool   `json:"remCmd"`
	ChannelId string `json:"channelId"`
}

// Bot parameters
var (
	GuildID        string
	BotToken       string
	RemoveCommands bool
)
var ChannelStruct discordConnection

var s *discordgo.Session

var (
	integerOptionMinValue          = 1.0
	dmPermission                   = false
	defaultMemberPermissions int64 = discordgo.PermissionManageServer

	commands = []*discordgo.ApplicationCommand{
		{
			Name:        "add-manga",
			Description: "PLEASE READ THE OPTION DESCRIPTIONS",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "name",
					Description: "name of the manga NO spaces",
					Required:    true,
				},
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "website",
					Description: "example mangasee123.com/manga/example-chapter-1",
					Required:    true,
				},
				{
					Type:        discordgo.ApplicationCommandOptionInteger,
					Name:        "latest-chapter",
					Description: "The latest released chapter",
					Required:    true,
				},
			},
		}, {
			Name:        "manga-list",
			Description: "List of all the manga being monitored",
		}, {
			Name:        "website-list",
			Description: "List of supported websites",
		}, {
			Name:        "set-notification-channel",
			Description: "Set the channel where the bot will send notifications of new chapters",
		},
	}

	commandHandlers = map[string]func(s *discordgo.Session, i *discordgo.InteractionCreate){
		"add-manga": func(s *discordgo.Session, i *discordgo.InteractionCreate) {
			// Access options in the order provided by the user.
			options := i.ApplicationCommandData().Options

			// Or convert the slice into a map
			optionMap := make(map[string]*discordgo.ApplicationCommandInteractionDataOption, len(options))
			for _, opt := range options {
				optionMap[opt.Name] = opt
			}

			// This example stores the provided arguments in an []interface{}
			// which will be used to format the bot's response
			margs := make([]interface{}, 0, len(options))
			msgformat := "You have submitted the following to the monitor:\n"

			// Get the value from the option map.
			// When the option exists, ok = true
			if option, ok := optionMap["website"]; ok {
				margs = append(margs, option.StringValue())
				msgformat += "> string-option: %s\n"
			}

			if opt, ok := optionMap["latest-chapter"]; ok {
				margs = append(margs, opt.IntValue())
				msgformat += "> integer-option: %d\n"
			}

			if option, ok := optionMap["name"]; ok {
				margs = append(margs, option.StringValue())
				msgformat += "> string-option: %s\n"
			}
			if option, ok := optionMap["release-method"]; ok {
				margs = append(margs, option.StringValue())
				msgformat += "> string-option: %s\n"
			}

			intconv := int(margs[1].(int64))
			identifier := identifierRegex(margs[0].(string))
			var entry MangaEntry = MangaEntry{
				Did:          primitive.NewObjectID(),
				Dmanga:       margs[2].(string),
				DlastChapter: intconv,
				Dmonitoring:  true,
				DchapterLink: margs[0].(string),
				Didentifier:  identifier,
			}
			MangaUpdate(entry)

			err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				// Ignore type for now, they will be discussed in "responses"
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: fmt.Sprintf(
						msgformat,
						margs...,
					),
				},
			})
			if err != nil {
				log.Println(err)
				return
			}
		},
		"manga-list": func(s *discordgo.Session, i *discordgo.InteractionCreate) {
			err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				// Ignore type for now, they will be discussed in "responses"
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: fmt.Sprintf(
						"List of all the manga being monitored: ",
					),
				},
			})
			if err != nil {
				log.Println(err)
				return
			}
			mangaList := MangaSync()
			// Create a string representation of the manga list
			var mangaListStr strings.Builder
			for _, manga := range mangaList {
				if manga.Dmonitoring {
					mangaListStr.WriteString(fmt.Sprintf("Manga: %s, Last Chapter: %d\n", manga.Dmanga, manga.DlastChapter))
				}
			}

			// Send the manga list to the channel where the command was executed
			_, err = s.ChannelMessageSend(i.ChannelID, mangaListStr.String())
			if err != nil {
				log.Printf("Failed to send message: %v", err)
			}
		},
		"website-list": func(s *discordgo.Session, i *discordgo.InteractionCreate) {
			err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				// Ignore type for now, they will be discussed in "responses"
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: fmt.Sprintf(
						"List of supported websites: \nasurascans.us \nhivescans.com \n toongod.org\n",
					),
				},
			})
			if err != nil {
				log.Println(err)
				return
			}

		},
		"set-notification-channel": func(s *discordgo.Session, i *discordgo.InteractionCreate) {
			ChannelStruct.ChannelId = i.ChannelID
			err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
				// Ignore type for now, they will be discussed in "responses"
				Type: discordgo.InteractionResponseChannelMessageWithSource,
				Data: &discordgo.InteractionResponseData{
					Content: fmt.Sprintf(
						"This channel was set\n",
					),
				},
			})
			if err != nil {
				log.Println(err)
				return
			}
			ChannelSet(ChannelStruct)
		},
	}
)

func identifierRegex(identifier string) string {
	u, err := url.Parse(identifier)
	if err != nil {
		log.Panicf("Invalid URL: %v", err)
	}
	hostParts := strings.Split(u.Hostname(), ".")
	log.Printf("HostParts: %v was added as an identifier", hostParts)

	return hostParts[len(hostParts)-2]
}

func Main(dcs discordConnection, group *sync.WaitGroup) {

	GuildID = dcs.GuildID
	BotToken = dcs.BotToken
	RemoveCommands = dcs.RemCmd
	ChannelStruct.ChannelId = dcs.ChannelId

	log.Println("Starting bot...")

	var err error
	s, err = discordgo.New("Bot " + BotToken)
	if err != nil {
		log.Fatalf("Invalid bot parameters: %v", err)
	}
	s.AddHandler(func(s *discordgo.Session, i *discordgo.InteractionCreate) {
		if h, ok := commandHandlers[i.ApplicationCommandData().Name]; ok {
			h(s, i)
		}
	})

	s.AddHandler(func(s *discordgo.Session, r *discordgo.Ready) {
		log.Printf("Logged in as: %v#%v", s.State.User.Username, s.State.User.Discriminator)
	})
	err = s.Open()
	if err != nil {
		log.Fatalf("Cannot open the session: %v", err)
	}

	log.Println("Adding commands...")
	registeredCommands := make([]*discordgo.ApplicationCommand, len(commands))
	for i, v := range commands {
		cmd, err := s.ApplicationCommandCreate(s.State.User.ID, GuildID, v)
		if err != nil {
			log.Panicf("Cannot create '%v' command: %v", v.Name, err)
		}
		registeredCommands[i] = cmd
	}
	log.Println("Commands added, App is live")

	defer func(s *discordgo.Session) {
		err := s.Close()
		if err != nil {

		}
	}(s)
	http.HandleFunc("/discord/channel-message", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if len(ChannelStruct.ChannelId) > 1 {
			var manga MangaEntry
			if err = json.NewDecoder(r.Body).Decode(&manga); err != nil {
				panic(err)
			}
			err = r.Body.Close()
			if err != nil {
				log.Panic(err)
			}
			var title = "New " + manga.Dmanga + " Chapter Released"
			var description = "Find it here! : " + manga.DchapterLink
			embed := &discordgo.MessageEmbed{
				Author: &discordgo.MessageEmbedAuthor{},
				Color:  5814783, // Green color
				Fields: []*discordgo.MessageEmbedField{
					{
						Name:   "LINK BELOW",
						Value:  description,
						Inline: true,
					},
				},
				Image: &discordgo.MessageEmbedImage{
					URL: s.State.User.AvatarURL(""),
				},
				Title: title,
			}

			_, err := s.ChannelMessageSendEmbed(ChannelStruct.ChannelId, embed)
			if err != nil {
				log.Printf("Failed to send embed message: %v", err)
			}
			w.WriteHeader(http.StatusOK)

		}

	})

	group.Done()

	go func() {
		err2 := http.ListenAndServe(":8081", nil)
		if err2 != nil {
			log.Fatalf("Cannot start the server: %v", err2)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	log.Println("Press Ctrl+C to exit")
	<-stop

	if RemoveCommands {
		log.Println("Removing commands...")
		// // We need to fetch the commands, since deleting requires the command ID.
		// // We are doing this from the returned commands on line 375, because using
		// // this will delete all the commands, which might not be desirable, so we
		// // are deleting only the commands that we added.
		// registeredCommands, err := s.ApplicationCommands(s.State.User.ID, *GuildID)
		// if err != nil {
		// 	log.Fatalf("Could not fetch registered commands: %v", err)
		// }

		for _, v := range registeredCommands {
			err := s.ApplicationCommandDelete(s.State.User.ID, GuildID, v.ID)
			if err != nil {
				log.Panicf("Cannot delete '%v' command: %v", v.Name, err)
			}
		}
	}

	log.Println("Gracefully shutting down.")
}

func MangaUpdate(manga MangaEntry) {
	log.Println("Manga being sent to DB server : %v", manga)
	mangaJson, err := json.Marshal(manga)
	if err != nil {
		log.Println(err)
	}
	r, err := http.NewRequest("POST", "http://localhost:8080/Manga/add-manga", bytes.NewBuffer(mangaJson))
	if err != nil {

		log.Println(err)
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {

		}
	}(r.Body)
	r.Header.Set("Content-Type", "application/json")
	clnt := http.DefaultClient
	resp, err := clnt.Do(r)
	if err != nil {
		log.Println(err)

	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {

		}
	}(resp.Body)
	//built in a response reader, to be used later for feature completion.
}

func MangaSync() []MangaEntry {
	r, err := http.Get("http://localhost:8080/Manga/get-list")
	if err != nil {
		panic(err)
	}

	var MangaList []MangaEntry
	if err = json.NewDecoder(r.Body).Decode(&MangaList); err != nil {
		panic(err)
	}
	err = r.Body.Close()
	if err != nil {
		log.Panic(err)
	}
	return MangaList
}

func ChannelSet(channelId discordConnection) {
	channelMarshaled, err := json.Marshal(channelId.ChannelId)
	if err != nil {
		log.Panicf("Couldn't marshal channelId")
	}
	r, err := http.NewRequest("POST", "http://localhost:8079/data/set", bytes.NewBuffer(channelMarshaled))
	if err != nil {
		log.Fatal("Couldn't send channel ID to data api")
	}

	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {

		}
	}(r.Body)
	r.Header.Set("Content-Type", "application/json")
	clnt := http.DefaultClient
	resp, err := clnt.Do(r)
	if err != nil {
		log.Println(err)

	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {

		}
	}(resp.Body)

}
