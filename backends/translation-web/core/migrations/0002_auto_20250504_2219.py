from django.db import migrations, models
from django.apps import apps

class Migration(migrations.Migration):
    atomic = False              # DDL roll-back 불가 DB이므로
    dependencies = [("core", "0001_initial")]

    operations = [
        migrations.RunSQL(
            # 실제 DDL
            sql="""
                ALTER TABLE `core_translationdata`
                ADD FULLTEXT INDEX `content_ft` (`content`);
            """,
            reverse_sql="""
                ALTER TABLE `core_translationdata`
                DROP INDEX `content_ft`;
            """,
            # 👉 **state_operations** 만 따로 지정
            state_operations=[
                migrations.AddIndex(
                    model_name="translationdata",
                    index=models.Index(
                        fields=["content"],
                        name="content_ft",
                    ),
                ),
            ],
        ),
    ]
