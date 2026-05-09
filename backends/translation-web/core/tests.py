from django.contrib.admin.models import ADDITION, CHANGE, DELETION, LogEntry
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase


class StatisticsEndpointTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="Alice")
        self.content_type = ContentType.objects.get_for_model(get_user_model())

    def log_action(self, action_flag):
        LogEntry.objects.create(
            user=self.user,
            content_type=self.content_type,
            object_id=str(self.user.pk),
            object_repr=self.user.username,
            action_flag=action_flag,
            change_message="",
        )

    def test_statistics_endpoint_is_public_json(self):
        self.log_action(ADDITION)
        self.log_action(CHANGE)
        self.log_action(CHANGE)
        self.log_action(DELETION)

        response = self.client.get("/statistics")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertEqual(response.json(), {
            "period": "all_time",
            "users": [{
                "username": "Alice",
                "created": 1,
                "edited": 2,
                "deleted": 1,
            }],
        })

    def test_statistics_endpoint_allows_cors(self):
        response = self.client.get("/statistics", HTTP_ORIGIN="https://crawl.nemelex.cards")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["access-control-allow-origin"], "*")
